import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
function formatPickLabel(season: string, round: number): string {
  const year = season.split('-')[0].slice(-2);
  return `'${year} ${ORDINALS[round - 1] ?? `${round}th`}`;
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

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'execute-trade');
    if (rateLimited) return rateLimited;

    const { proposal_id } = await req.json();
    if (!proposal_id) throw new Error('proposal_id is required');

    const { data: proposal, error: proposalError } = await supabaseAdmin
      .from('trade_proposals')
      .select('*')
      .eq('id', proposal_id)
      .single();
    if (proposalError || !proposal) throw new Error('Trade proposal not found.');

    if (proposal.status !== 'accepted' && proposal.status !== 'in_review' && proposal.status !== 'delayed') {
      throw new Error(`Cannot execute trade with status: ${proposal.status}`);
    }

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, trade_deadline, taxi_slots, taxi_max_experience, season')
      .eq('id', proposal.league_id)
      .single();

    // Block trades past the deadline
    if (league?.trade_deadline) {
      const deadline = new Date(league.trade_deadline + 'T23:59:59Z');
      if (new Date() > deadline) {
        throw new Error('The trade deadline has passed. No trades can be executed.');
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
        .in('trade_proposals.status', ['pending', 'accepted', 'in_review', 'delayed']);

      if (allPlayerIds.length > 0 && allPickIds.length > 0) {
        lockedQuery = lockedQuery.or(`player_id.in.(${allPlayerIds.join(',')}),draft_pick_id.in.(${allPickIds.join(',')})`);
      } else if (allPlayerIds.length > 0) {
        lockedQuery = lockedQuery.in('player_id', allPlayerIds);
      } else {
        lockedQuery = lockedQuery.in('draft_pick_id', allPickIds);
      }

      const { data: conflicting } = await lockedQuery;
      if (conflicting && conflicting.length > 0) {
        throw new Error('One or more assets in this trade are involved in another active trade proposal. Please resolve those trades first.');
      }
    }

    const isCommissioner = league?.created_by === user.id;

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
            .eq('user_id', user.id)
            .single()
        ).data?.id ?? '')
        .single();

      if (!userTeamInTrade) {
        throw new Error('Only trade parties or the commissioner can execute a trade.');
      }
    }

    const timestamp = new Date().toISOString();
    const todayDate = timestamp.slice(0, 10); // YYYY-MM-DD
    const swapItems = items.filter((i: any) => i.pick_swap_season != null);

    // Snapshot pre-trade rosters into daily_lineups so historical views are preserved
    const affectedTeamIds = [...new Set(playerItems.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];
    for (const tid of affectedTeamIds) {
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
          .upsert(rows, { onConflict: 'team_id,player_id,lineup_date' });
      }
    }

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

    for (const item of playerItems) {
      let targetSlot = 'BE';

      // If player was on taxi and receiving team has taxi capacity + player is eligible, keep on taxi
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

      const { error } = await supabaseAdmin
        .from('league_players')
        .update({
          team_id: item.to_team_id,
          acquired_via: 'trade',
          acquired_at: timestamp,
          roster_slot: targetSlot,
        })
        .eq('league_id', proposal.league_id)
        .eq('player_id', item.player_id)
        .eq('team_id', item.from_team_id);
      if (error) throw new Error(`Failed to transfer player ${item.player_id}: ${error.message}`);

      // Mark outgoing player as DROPPED on their old team's daily_lineups
      await supabaseAdmin
        .from('daily_lineups')
        .upsert(
          {
            league_id: proposal.league_id,
            team_id: item.from_team_id,
            player_id: item.player_id,
            lineup_date: todayDate,
            roster_slot: 'DROPPED',
          },
          { onConflict: 'team_id,player_id,lineup_date' },
        );
      // Remove any future lineup entries for the outgoing player on the old team
      await supabaseAdmin
        .from('daily_lineups')
        .delete()
        .eq('league_id', proposal.league_id)
        .eq('team_id', item.from_team_id)
        .eq('player_id', item.player_id)
        .gt('lineup_date', todayDate);
    }

    for (const item of pickItems) {
      const updatePayload: any = { current_team_id: item.to_team_id };
      if (item.protection_threshold) {
        updatePayload.protection_threshold = item.protection_threshold;
        updatePayload.protection_owner_id = item.from_team_id;
      }
      const { error } = await supabaseAdmin
        .from('draft_picks')
        .update(updatePayload)
        .eq('id', item.draft_pick_id);
      if (error) throw new Error(`Failed to transfer pick ${item.draft_pick_id}: ${error.message}`);
    }

    // Insert pick swap rows
    if (swapItems.length > 0) {
      const swapRows = swapItems.map((item: any) => ({
        league_id: proposal.league_id,
        season: item.pick_swap_season,
        round: item.pick_swap_round,
        beneficiary_team_id: item.to_team_id,
        counterparty_team_id: item.from_team_id,
        created_by_proposal_id: proposal_id,
      }));
      const { error: swapError } = await supabaseAdmin.from('pick_swaps').insert(swapRows);
      if (swapError) throw new Error(`Failed to create pick swaps: ${swapError.message}`);
    }

    const playerIds = playerItems.map((i: any) => i.player_id);
    let playerNameMap: Record<string, string> = {};
    if (playerIds.length > 0) {
      const { data: players } = await supabaseAdmin.from('players').select('id, name').in('id', playerIds);
      if (players) playerNameMap = Object.fromEntries(players.map((p: any) => [p.id, p.name]));
    }

    const pickIds = pickItems.map((i: any) => i.draft_pick_id);
    let pickInfoMap: Record<string, string> = {};
    if (pickIds.length > 0) {
      const { data: picks } = await supabaseAdmin.from('draft_picks').select('id, season, round').in('id', pickIds);
      if (picks) pickInfoMap = Object.fromEntries(picks.map((p: any) => [p.id, formatPickLabel(p.season, p.round)]));
    }

    const allTeamIds = [...new Set(items.flatMap((i: any) => [i.from_team_id, i.to_team_id]))];
    let teamNameMap: Record<string, string> = {};
    if (allTeamIds.length > 0) {
      const { data: teams } = await supabaseAdmin.from('teams').select('id, name').in('id', allTeamIds);
      if (teams) teamNameMap = Object.fromEntries(teams.map((t: any) => [t.id, t.name]));
    }

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

    const { data: txn, error: txnError } = await supabaseAdmin
      .from('league_transactions')
      .insert({ league_id: proposal.league_id, type: 'trade', notes, team_id: proposal.proposed_by_team_id })
      .select('id')
      .single();
    if (txnError) throw new Error(`Failed to create transaction: ${txnError.message}`);

    const txnItems = items.map((item: any) => ({
      transaction_id: txn.id,
      player_id: item.player_id,
      draft_pick_id: item.draft_pick_id,
      team_from_id: item.from_team_id,
      team_to_id: item.to_team_id,
    }));
    const { error: txnItemsError } = await supabaseAdmin.from('league_transaction_items').insert(txnItems);
    if (txnItemsError) throw new Error(`Failed to create transaction items: ${txnItemsError.message}`);

    const { error: completeError } = await supabaseAdmin
      .from('trade_proposals')
      .update({ status: 'completed', completed_at: timestamp, transaction_id: txn.id })
      .eq('id', proposal_id);
    if (completeError) throw new Error(`Failed to update proposal: ${completeError.message}`);

    // Notify all teams involved in the trade
    try {
      const ln = league?.name ?? 'Your League';
      await notifyTeams(supabaseAdmin, allTeamIds, 'trades',
        `${ln} — Trade Completed!`,
        notes,
        { screen: 'trades', proposal_id }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: 'Trade completed!', transaction_id: txn.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('execute-trade error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
