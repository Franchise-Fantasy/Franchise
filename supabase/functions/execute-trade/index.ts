import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { snapshotBeforeDrop } from '../_shared/snapshotBeforeDrop.ts';
import { checkPositionLimitsForRoster } from '../_shared/positionLimits.ts';
import { fetchIllegalIRPlayers, formatIllegalIRError } from '../_shared/illegalIR.ts';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
function formatPickLabel(season: string, round: number): string {
  // Draft for "2026-27" season happens in summer 2026, so use the start year
  const year = String(parseInt(season.split('-')[0], 10)).slice(-2);
  return `'${year} ${ORDINALS[round - 1] ?? `${round}th`}`;
}

// Hype scoring: determines trade announcement tier
function computeHypeScore(
  items: any[],
  playerFptsMap: Record<string, number>,
  leagueFptsThresholds: { top10: number; top30: number; top75: number },
): { score: number; tier: 'minor' | 'major' | 'blockbuster'; hasTop10: boolean } {
  let score = 0;
  let firstRoundCount = 0;
  let hasTop10 = false;
  const teamIds = new Set(items.flatMap((i: any) => [i.from_team_id, i.to_team_id]));

  for (const item of items) {
    if (item.pick_swap_season) {
      score += 4;
      continue;
    }
    if (item.player_id) {
      const fpts = playerFptsMap[item.player_id] ?? 0;
      if (fpts >= leagueFptsThresholds.top10) { score += 25; hasTop10 = true; }
      else if (fpts >= leagueFptsThresholds.top30) score += 15;
      else if (fpts >= leagueFptsThresholds.top75) score += 8;
      else score += 3;
    } else if (item.draft_pick_id) {
      // Pick round is on the item from the original fetch
      const round = item.pick_round ?? item.round;
      if (round === 1) { score += 12; firstRoundCount++; }
      else if (round === 2) score += 6;
      else score += 3;
    }
  }

  // Bonuses
  if (teamIds.size >= 3) score += 15;
  if (firstRoundCount > 1) score += (firstRoundCount - 1) * 5;

  // Top-10 player override
  const tier = hasTop10 ? 'blockbuster' : score >= 50 ? 'blockbuster' : score >= 25 ? 'major' : 'minor';
  return { score, tier, hasTop10 };
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Detect server-to-server calls (cron / process-pending-transactions)
    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isServerCall = authHeader === `Bearer ${serviceRoleKey}`;

    let user: { id: string } | null = null;
    if (!isServerCall) {
      const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: token ?? '' } } }
      );
      const { data } = await userClient.auth.getUser();
      user = data?.user ?? null;
      if (!user) throw new Error('Unauthorized');

      const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'execute-trade');
      if (rateLimited) return rateLimited;
    }

    const { proposal_id } = await req.json();
    if (!proposal_id) throw new Error('proposal_id is required');

    const { data: proposal, error: proposalError } = await supabaseAdmin
      .from('trade_proposals')
      .select('*')
      .eq('id', proposal_id)
      .single();
    if (proposalError || !proposal) throw new Error('Trade proposal not found.');

    // Idempotency: if the trade was already executed, return success
    if (proposal.transaction_id != null) {
      return new Response(JSON.stringify({ ok: true, message: 'Trade already executed.' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!['accepted', 'in_review', 'delayed', 'pending_drops'].includes(proposal.status)) {
      throw new Error(`Cannot execute trade with status: ${proposal.status}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, trade_deadline, taxi_slots, taxi_max_experience, season, roster_size, position_limits, waiver_type, waiver_period_days')
      .eq('id', proposal.league_id)
      .single();

    // Block trades past the deadline
    if (league?.trade_deadline) {
      const deadline = new Date(league.trade_deadline + 'T23:59:59Z');
      if (new Date() > deadline) {
        throw new Error('The trade deadline has passed. No trades can be executed.');
      }
    }

    // Authorization: server calls (cron) are pre-authorized; user calls require commissioner or trade party
    if (!isServerCall) {
      const isCommissioner = league?.created_by === user!.id;

      if (!isCommissioner) {
        const { data: userTeamInTrade } = await supabaseAdmin
          .from('trade_proposal_teams')
          .select('id')
          .eq('proposal_id', proposal_id)
          .eq('team_id', (
            await supabaseAdmin
              .from('teams')
              .select('id')
              .eq('league_id', proposal.league_id)
              .eq('user_id', user!.id)
              .single()
          ).data?.id ?? '')
          .single();

        if (!userTeamInTrade) {
          throw new Error('Only trade parties or the commissioner can execute a trade.');
        }
      }
    }

    // Fetch items early so we can check for live games and locked assets
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('trade_proposal_items')
      .select('*')
      .eq('proposal_id', proposal_id);
    if (itemsError) throw itemsError;
    if (!items || items.length === 0) throw new Error('No items in this trade proposal.');

    const playerItems = items.filter((i: any) => i.player_id != null);

    // Auto-delay trade if any involved player has a live game
    const tradedPlayerIds = playerItems.map((i: any) => i.player_id);
    if (tradedPlayerIds.length > 0 && proposal.status !== 'delayed') {
      const { data: liveGames } = await supabaseAdmin
        .from('live_player_stats')
        .select('player_id, game_status')
        .in('player_id', tradedPlayerIds)
        .eq('game_status', 2);

      if (liveGames && liveGames.length > 0) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const executeAfter = toDateStr(tomorrow);

        await supabaseAdmin
          .from('trade_proposals')
          .update({ status: 'delayed' })
          .eq('id', proposal_id);

        await supabaseAdmin.from('pending_transactions').insert({
          league_id: proposal.league_id,
          team_id: proposal.proposed_by_team_id,
          action_type: 'trade',
          status: 'pending',
          execute_after: executeAfter,
          metadata: { proposal_id },
        });

        return new Response(
          JSON.stringify({ message: 'Trade delayed — involved players have games in progress. It will process automatically tomorrow morning.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Block trade if any involved assets are in another active trade proposal
    const allPlayerIds = playerItems.map((i: any) => i.player_id);
    const pickItems = items.filter((i: any) => i.draft_pick_id != null);
    const allPickIds = pickItems.map((i: any) => i.draft_pick_id);

    if (allPlayerIds.length > 0 || allPickIds.length > 0) {
      let lockedQuery = supabaseAdmin
        .from('trade_proposal_items')
        .select('id, player_id, draft_pick_id, trade_proposals!inner(id, status)')
        .neq('trade_proposals.id', proposal_id)
        .in('trade_proposals.status', ['pending', 'accepted', 'in_review', 'delayed', 'pending_drops']);

      if (allPlayerIds.length > 0 && allPickIds.length > 0) {
        lockedQuery = lockedQuery.or(`player_id.in.(${allPlayerIds.join(',')}),draft_pick_id.in.(${allPickIds.join(',')})`);
      } else if (allPlayerIds.length > 0) {
        lockedQuery = lockedQuery.in('player_id', allPlayerIds);
      } else {
        lockedQuery = lockedQuery.in('draft_pick_id', allPickIds);
      }

      const { data: conflicting } = await lockedQuery;
      if (conflicting && conflicting.length > 0) {
        // If this trade is already in_review (review period expired), it has priority —
        // auto-cancel any conflicting pending/accepted proposals instead of blocking.
        if (['in_review', 'delayed'].includes(proposal.status)) {
          const conflictingIds = [...new Set(
            conflicting.map((c: any) => (c as any).trade_proposals.id),
          )];
          for (const cid of conflictingIds) {
            await supabaseAdmin
              .from('trade_proposals')
              .update({ status: 'cancelled' })
              .eq('id', cid)
              .in('status', ['pending', 'accepted']);
          }
        } else {
          throw new Error('One or more assets in this trade are involved in another active trade proposal. Please resolve those trades first.');
        }
      }
    }

    // Block trade if any traded player is the drop target of a pending waiver claim
    if (allPlayerIds.length > 0) {
      const { data: waiverConflicts } = await supabaseAdmin
        .from('waiver_claims')
        .select('drop_player_id')
        .in('drop_player_id', allPlayerIds)
        .eq('league_id', proposal.league_id)
        .eq('status', 'pending');
      if (waiverConflicts && waiverConflicts.length > 0) {
        throw new Error('One or more players in this trade are queued for drop in a pending waiver claim. Cancel the waiver claim first.');
      }
    }

    // Roster capacity check — ensure no team exceeds roster_size after the trade
    const rosterSize = league?.roster_size ?? 13;
    if (playerItems.length > 0) {
      const netPlayersByTeam = new Map<string, number>();
      for (const item of playerItems) {
        netPlayersByTeam.set(item.from_team_id, (netPlayersByTeam.get(item.from_team_id) ?? 0) - 1);
        netPlayersByTeam.set(item.to_team_id, (netPlayersByTeam.get(item.to_team_id) ?? 0) + 1);
      }

      // Fetch drop selections from trade_proposal_teams
      const { data: proposalTeams } = await supabaseAdmin
        .from('trade_proposal_teams')
        .select('team_id, drop_player_ids')
        .eq('proposal_id', proposal_id);
      const dropsByTeam = new Map<string, string[]>(
        (proposalTeams ?? [])
          .filter((t: any) => t.drop_player_ids && t.drop_player_ids.length > 0)
          .map((t: any) => [t.team_id, t.drop_player_ids as string[]]),
      );

      const teamsNeedingDrops: string[] = [];
      for (const [tid, netGain] of netPlayersByTeam) {
        if (netGain <= 0) continue;
        // Each selected drop offsets one gained player
        const dropOffset = dropsByTeam.get(tid)?.length ?? 0;
        const effectiveGain = netGain - dropOffset;
        if (effectiveGain <= 0) continue;

        const [allRes, irRes] = await Promise.all([
          supabaseAdmin.from('league_players').select('id', { count: 'exact', head: true })
            .eq('league_id', proposal.league_id).eq('team_id', tid),
          supabaseAdmin.from('league_players').select('id', { count: 'exact', head: true })
            .eq('league_id', proposal.league_id).eq('team_id', tid).eq('roster_slot', 'IR'),
        ]);
        const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
        if (activeCount + effectiveGain > rosterSize) {
          teamsNeedingDrops.push(tid);
        }
      }

      if (teamsNeedingDrops.length > 0) {
        // Set trade to pending_drops and notify affected teams
        await supabaseAdmin
          .from('trade_proposals')
          .update({ status: 'pending_drops' })
          .eq('id', proposal_id);

        const { data: teamNames } = await supabaseAdmin
          .from('teams')
          .select('id, name')
          .in('id', teamsNeedingDrops);
        const names = (teamNames ?? []).map((t: any) => t.name).join(', ');

        await notifyTeams(supabaseAdmin, teamsNeedingDrops, 'trades',
          'Roster Move Required',
          'A trade is waiting on you to drop a player to make room.',
          { screen: 'trades', proposal_id },
        );

        return new Response(
          JSON.stringify({ message: `Trade is pending roster drops from: ${names}. They must select a player to drop before the trade can complete.`, pending_drops: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Process approved drops before the trade transfers
      const waiverType = league?.waiver_type ?? 'none';
      const waiverDays = league?.waiver_period_days ?? 2;
      for (const [tid, dropPlayerIds] of dropsByTeam) {
        for (const dropPlayerId of dropPlayerIds) {
          await snapshotBeforeDrop(supabaseAdmin, proposal.league_id, tid, dropPlayerId);
          await supabaseAdmin
            .from('league_players')
            .delete()
            .eq('league_id', proposal.league_id)
            .eq('team_id', tid)
            .eq('player_id', dropPlayerId);

          // Place dropped player on waivers so they don't become an instant free agent
          if (waiverType !== 'none' && waiverDays > 0) {
            const raw = new Date();
            raw.setDate(raw.getDate() + waiverDays);
            const until = new Date(Date.UTC(
              raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 6, 0, 0, 0,
            ));
            if (raw.getTime() > until.getTime()) until.setUTCDate(until.getUTCDate() + 1);

            await supabaseAdmin.from('league_waivers').insert({
              league_id: proposal.league_id,
              player_id: dropPlayerId,
              on_waivers_until: until.toISOString(),
              dropped_by_team_id: tid,
            });
          }
        }
      }
    }

    // Position limit check — ensure no team exceeds position limits after the trade
    const positionLimits = league?.position_limits as Record<string, number> | null;
    if (positionLimits && Object.keys(positionLimits).length > 0 && playerItems.length > 0) {
      const affectedTeamIdsForLimits = [...new Set(playerItems.map((i: any) => i.to_team_id))];

      // Parallel position limit checks for all affected teams
      const limitResults = await Promise.all(
        affectedTeamIdsForLimits.map(async (tid) => {
          const { data: currentRoster } = await supabaseAdmin
            .from('league_players')
            .select('player_id, position, roster_slot')
            .eq('league_id', proposal.league_id)
            .eq('team_id', tid);

          const outgoingIds = new Set(
            playerItems.filter((i: any) => i.from_team_id === tid).map((i: any) => i.player_id),
          );
          const incomingIds = playerItems
            .filter((i: any) => i.to_team_id === tid)
            .map((i: any) => i.player_id);

          const { data: incomingPlayers } = await supabaseAdmin
            .from('players')
            .select('id, position')
            .in('id', incomingIds);
          const incomingPosMap = new Map((incomingPlayers ?? []).map((p: any) => [p.id, p.position]));

          const postTradeRoster = [
            ...(currentRoster ?? []).filter((p: any) => !outgoingIds.has(p.player_id)),
            ...incomingIds.map((pid: string) => ({
              position: incomingPosMap.get(pid) ?? 'UTIL',
              roster_slot: 'BE',
            })),
          ];

          const violation = checkPositionLimitsForRoster(positionLimits, postTradeRoster);
          return { tid, violation };
        }),
      );

      for (const { tid, violation } of limitResults) {
        if (violation) {
          const { data: teamInfo } = await supabaseAdmin.from('teams').select('name').eq('id', tid).single();
          throw new Error(
            `Trade would cause ${teamInfo?.name ?? 'a team'} to exceed the ${violation.position} position limit (${violation.count}/${violation.max}).`,
          );
        }
      }
    }

    const timestamp = new Date().toISOString();
    const todayDate = timestamp.slice(0, 10); // YYYY-MM-DD
    const swapItems = items.filter((i: any) => i.pick_swap_season != null);

    // Snapshot pre-trade rosters into daily_lineups so historical views are preserved
    const affectedTeamIds = [...new Set(playerItems.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];
    await Promise.all(affectedTeamIds.map(async (tid) => {
      const { data: roster } = await supabaseAdmin
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('league_id', proposal.league_id)
        .eq('team_id', tid);
      if (roster && roster.length > 0) {
        const rows = roster.map((r: any) => ({
          league_id: proposal.league_id,
          team_id: tid,
          player_id: r.player_id,
          lineup_date: todayDate,
          roster_slot: r.roster_slot ?? 'BE',
        }));
        await supabaseAdmin
          .from('daily_lineups')
          .upsert(rows, { onConflict: 'team_id,player_id,lineup_date', ignoreDuplicates: true });
      }
    }));

    // Pre-compute taxi counts per receiving team for taxi-to-taxi trades
    const taxiCountByTeam = new Map<string, number>();
    if (league?.taxi_slots && league.taxi_slots > 0) {
      const receivingTeamIds = [...new Set(playerItems.map((i: any) => i.to_team_id))];
      for (const tid of receivingTeamIds) {
        const { count } = await supabaseAdmin
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', proposal.league_id)
          .eq('team_id', tid)
          .eq('roster_slot', 'TAXI');
        taxiCountByTeam.set(tid, count ?? 0);
      }
    }

    // Get current roster slots and draft years for traded players
    const [slotRes, draftYearRes] = await Promise.all([
      supabaseAdmin.from('league_players').select('player_id, roster_slot')
        .eq('league_id', proposal.league_id).in('player_id', tradedPlayerIds),
      supabaseAdmin.from('players').select('id, nba_draft_year')
        .in('id', tradedPlayerIds),
    ]);
    const currentSlotMap = new Map((slotRes.data ?? []).map((r: any) => [r.player_id, r.roster_slot]));
    const draftYearMap = new Map((draftYearRes.data ?? []).map((p: any) => [p.id, p.nba_draft_year]));

    // Block trading players currently on IR
    const irPlayers = tradedPlayerIds.filter((pid: string) => currentSlotMap.get(pid) === 'IR');
    if (irPlayers.length > 0) {
      throw new Error('Players on IR cannot be traded. Activate them from IR first.');
    }

    // Block trade if either team has a player in an IR slot who is no longer
    // injured. Delayed cron re-executions bypass (already validated at submission).
    if (!isServerCall) {
      const teamsInTrade = [...new Set(playerItems.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];
      for (const tid of teamsInTrade) {
        const illegal = await fetchIllegalIRPlayers(supabaseAdmin, proposal.league_id, tid as string);
        if (illegal.length > 0) {
          const { data: teamInfo } = await supabaseAdmin.from('teams').select('name').eq('id', tid).single();
          const who = teamInfo?.name ?? 'A team';
          throw new Error(`${who} is locked out of roster moves — ${formatIllegalIRError(illegal)}`);
        }
      }
    }

    // Find current week start so we can snapshot outgoing players' slots for historical accuracy
    const { data: currentWeek } = await supabaseAdmin
      .from('league_schedule')
      .select('start_date')
      .eq('league_id', proposal.league_id)
      .lte('start_date', todayDate)
      .gte('end_date', todayDate)
      .maybeSingle();

    // Re-validate ownership: ensure every traded player is still on the expected team
    const { data: currentOwnership } = await supabaseAdmin
      .from('league_players')
      .select('player_id, team_id')
      .eq('league_id', proposal.league_id)
      .in('player_id', tradedPlayerIds);
    const ownershipMap = new Map((currentOwnership ?? []).map((r: any) => [r.player_id, r.team_id]));
    for (const item of playerItems) {
      if (ownershipMap.get(item.player_id) !== item.from_team_id) {
        throw new Error('A traded player is no longer on the expected roster. The trade cannot be completed.');
      }
    }

    // Compute target slots for each player move (taxi logic)
    const playerMoves = playerItems.map((item: any) => {
      let targetSlot = 'BE';
      if (currentSlotMap.get(item.player_id) === 'TAXI' && league?.taxi_slots && league.taxi_slots > 0) {
        const currentTaxiCount = taxiCountByTeam.get(item.to_team_id) ?? 0;
        if (currentTaxiCount < league.taxi_slots) {
          const draftYear = draftYearMap.get(item.player_id);
          const maxExp = league.taxi_max_experience;
          const eligible = maxExp === null || (draftYear != null && (parseInt(league.season.split('-')[0]) + 1 - draftYear) <= maxExp);
          if (eligible) {
            targetSlot = 'TAXI';
            taxiCountByTeam.set(item.to_team_id, currentTaxiCount + 1);
          }
        }
      }
      return {
        player_id: item.player_id,
        from_team_id: item.from_team_id,
        to_team_id: item.to_team_id,
        target_slot: targetSlot,
        pre_trade_slot: currentSlotMap.get(item.player_id) ?? 'BE',
      };
    });

    const pickMoves = pickItems.map((item: any) => ({
      draft_pick_id: item.draft_pick_id,
      from_team_id: item.from_team_id,
      to_team_id: item.to_team_id,
      protection_threshold: item.protection_threshold ?? null,
    }));

    const pickSwaps = swapItems.map((item: any) => ({
      season: item.pick_swap_season,
      round: item.pick_swap_round,
      beneficiary_team_id: item.to_team_id,
      counterparty_team_id: item.from_team_id,
    }));

    // Build transaction notes (need name lookups first)
    const playerIds = playerItems.map((i: any) => i.player_id);
    const pickIds = pickItems.map((i: any) => i.draft_pick_id);
    const allTeamIds = [...new Set(items.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];

    const [playerNameRes, pickInfoRes, teamNameRes] = await Promise.all([
      playerIds.length > 0
        ? supabaseAdmin.from('players').select('id, name').in('id', playerIds)
        : Promise.resolve({ data: [] }),
      pickIds.length > 0
        ? supabaseAdmin.from('draft_picks').select('id, season, round').in('id', pickIds)
        : Promise.resolve({ data: [] }),
      allTeamIds.length > 0
        ? supabaseAdmin.from('teams').select('id, name').in('id', allTeamIds)
        : Promise.resolve({ data: [] }),
    ]);

    const playerNameMap: Record<string, string> = Object.fromEntries(
      (playerNameRes.data ?? []).map((p: any) => [p.id, p.name]),
    );
    const pickInfoMap: Record<string, string> = Object.fromEntries(
      (pickInfoRes.data ?? []).map((p: any) => [p.id, formatPickLabel(p.season, p.round)]),
    );
    const teamNameMap: Record<string, string> = Object.fromEntries(
      (teamNameRes.data ?? []).map((t: any) => [t.id, t.name]),
    );

    const notesParts = items.map((item: any) => {
      if (item.pick_swap_season) {
        const from = teamNameMap[item.from_team_id] ?? 'Unknown';
        const to = teamNameMap[item.to_team_id] ?? 'Unknown';
        return `${formatPickLabel(item.pick_swap_season, item.pick_swap_round)} swap (${to} gets better pick vs ${from})`;
      }
      const asset = item.player_id
        ? playerNameMap[item.player_id] ?? 'Unknown Player'
        : pickInfoMap[item.draft_pick_id] ?? 'Unknown Pick';
      const protection = item.protection_threshold ? ` [Top-${item.protection_threshold} protected]` : '';
      const from = teamNameMap[item.from_team_id] ?? 'Unknown';
      const to = teamNameMap[item.to_team_id] ?? 'Unknown';
      return `${asset}${protection} (${from} -> ${to})`;
    });
    const notes = `Trade completed: ${notesParts.join(', ')}`;

    // Execute all mutations atomically in a single Postgres transaction.
    // If any step fails, everything rolls back — no half-executed trades.
    const { data: txnId, error: rpcError } = await supabaseAdmin.rpc('execute_trade_transfers', {
      p_league_id: proposal.league_id,
      p_proposal_id: proposal_id,
      p_proposed_by: proposal.proposed_by_team_id,
      p_timestamp: timestamp,
      p_today: todayDate,
      p_week_start: currentWeek?.start_date ?? null,
      p_player_moves: playerMoves,
      p_pick_moves: pickMoves,
      p_pick_swaps: pickSwaps,
      p_notes: notes,
    });
    if (rpcError) throw new Error(`Trade execution failed: ${rpcError.message}`);

    // Build trade summary for chat announcement
    let hypeTier: 'minor' | 'major' | 'blockbuster' = 'minor';
    try {
      // Fetch league-wide player rankings for hype scoring (exclude nulls so thresholds are accurate)
      const { data: allPlayerStats } = await supabaseAdmin
        .from('player_season_stats')
        .select('player_id, avg_pts')
        .not('avg_pts', 'is', null)
        .order('avg_pts', { ascending: false })
        .limit(150);

      const rankedFpts = (allPlayerStats ?? []).map((p: any) => p.avg_pts as number);
      const leagueFptsThresholds = {
        top10: rankedFpts[9] ?? Infinity,
        top30: rankedFpts[29] ?? Infinity,
        top75: rankedFpts[74] ?? Infinity,
      };

      const playerFptsMap: Record<string, number> = {};
      for (const ps of allPlayerStats ?? []) {
        playerFptsMap[ps.player_id] = ps.avg_pts;
      }

      // Enrich items with pick round info from pickInfoRes
      const pickRoundMap: Record<string, number> = {};
      for (const p of pickInfoRes.data ?? []) {
        pickRoundMap[p.id] = p.round;
      }
      const enrichedItems = items.map((item: any) => ({
        ...item,
        pick_round: item.draft_pick_id ? pickRoundMap[item.draft_pick_id] : undefined,
      }));

      const hypeResult = computeHypeScore(enrichedItems, playerFptsMap, leagueFptsThresholds);
      const hypeScore = hypeResult.score;
      hypeTier = hypeResult.tier;

      const teams = [...new Set(items.flatMap((i: any) => [i.from_team_id, i.to_team_id]))].map((tid) => ({
        team_id: tid,
        team_name: teamNameMap[tid] ?? 'Unknown',
      }));

      const moves = items.map((item: any) => {
        if (item.pick_swap_season) {
          return {
            asset: `${formatPickLabel(item.pick_swap_season, item.pick_swap_round)} swap`,
            asset_type: 'swap' as const,
            from_team_name: teamNameMap[item.from_team_id] ?? 'Unknown',
            to_team_name: teamNameMap[item.to_team_id] ?? 'Unknown',
            protection: null,
            avg_fpts: null,
          };
        }
        const isPlayer = !!item.player_id;
        return {
          asset: isPlayer
            ? (playerNameMap[item.player_id] ?? 'Unknown Player')
            : (pickInfoMap[item.draft_pick_id] ?? 'Unknown Pick'),
          asset_type: isPlayer ? 'player' as const : 'pick' as const,
          from_team_name: teamNameMap[item.from_team_id] ?? 'Unknown',
          to_team_name: teamNameMap[item.to_team_id] ?? 'Unknown',
          protection: item.protection_threshold ? `Top-${item.protection_threshold} protected` : null,
          avg_fpts: isPlayer ? (playerFptsMap[item.player_id] ?? null) : null,
        };
      });

      const tradeSummary = {
        teams,
        moves,
        total_assets: items.length,
        team_count: teams.length,
        hype_tier: hypeTier,
        hype_score: hypeScore,
      };

      // Store summary on the proposal
      await supabaseAdmin
        .from('trade_proposals')
        .update({ trade_summary: tradeSummary })
        .eq('id', proposal_id);

      // Post trade announcement to league chat
      const { data: leagueChat } = await supabaseAdmin
        .from('chat_conversations')
        .select('id')
        .eq('league_id', proposal.league_id)
        .eq('type', 'league')
        .single();

      if (leagueChat) {
        await supabaseAdmin.from('chat_messages').insert({
          conversation_id: leagueChat.id,
          team_id: proposal.proposed_by_team_id,
          content: proposal_id,
          type: 'trade',
          league_id: proposal.league_id,
        });
      }

      // Post "completed" update to the trade negotiation chat (if one exists).
      // Walk the counteroffer chain to find the root proposal (conversation is linked to root).
      let rootId = proposal_id;
      let cur = proposal.counteroffer_of;
      for (let i = 0; i < 20 && cur; i++) {
        rootId = cur;
        const { data: parent } = await supabaseAdmin
          .from('trade_proposals')
          .select('counteroffer_of')
          .eq('id', cur)
          .single();
        cur = parent?.counteroffer_of ?? null;
      }

      const { data: tradeConv } = await supabaseAdmin
        .from('chat_conversations')
        .select('id')
        .eq('trade_proposal_id', rootId)
        .eq('type', 'trade')
        .maybeSingle();

      if (tradeConv) {
        await supabaseAdmin.from('chat_messages').insert({
          conversation_id: tradeConv.id,
          team_id: null,
          content: JSON.stringify({ event: 'completed', team_name: null, proposal_id }),
          type: 'trade_update',
          league_id: proposal.league_id,
        });
      }
    } catch (summaryErr) {
      console.warn('Trade summary/chat post failed (non-fatal):', summaryErr);
    }

    // Notify all teams involved in the trade with hype-tiered messaging
    try {
      const ln = league?.name ?? 'Your League';
      const tierTitle = hypeTier === 'blockbuster'
        ? `${ln} — BLOCKBUSTER TRADE`
        : hypeTier === 'major'
          ? `${ln} — MAJOR TRADE`
          : `${ln} — Trade Completed`;
      await notifyTeams(supabaseAdmin, allTeamIds, 'trades',
        tierTitle,
        notes,
        { screen: 'trades', proposal_id }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: 'Trade completed!', transaction_id: txnId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('execute-trade error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
