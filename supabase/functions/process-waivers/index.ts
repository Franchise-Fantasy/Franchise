import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyTeams, notifyLeague } from '../_shared/push.ts';
import { snapshotBeforeDrop } from '../_shared/snapshotBeforeDrop.ts';
import { checkPositionLimits } from '../_shared/positionLimits.ts';
import { createLogger } from '../_shared/log.ts';

const log = createLogger('process-waivers');

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// Shared player name cache to avoid repeated lookups
const playerNameCache = new Map<string, string>();

async function resolvePlayerNames(playerIds: string[]) {
  const missing = playerIds.filter(id => !playerNameCache.has(id));
  if (missing.length === 0) return;
  const { data } = await supabase.from('players').select('id, name').in('id', [...new Set(missing)]);
  for (const p of data ?? []) playerNameCache.set(p.id, p.name);
}

function playerName(id: string): string {
  return playerNameCache.get(id) ?? 'a player';
}

// Shared team name cache
const teamNameCache = new Map<string, string>();

async function resolveTeamNames(teamIds: string[]) {
  const missing = teamIds.filter(id => !teamNameCache.has(id));
  if (missing.length === 0) return;
  const { data } = await supabase.from('teams').select('id, name').in('id', [...new Set(missing)]);
  for (const t of data ?? []) teamNameCache.set(t.id, t.name);
}

function teamName(id: string): string {
  return teamNameCache.get(id) ?? 'A team';
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const todayDow = now.getDay();
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Step A: Process Standard Waiver Claims (expired waiver periods)
  // Atomically claim expired waivers by deleting them upfront — if two
  // cron invocations overlap, only one gets each row (DELETE is atomic).
  try {
    const { data: expiredWaivers, error: ewErr } = await supabase
      .from('league_waivers')
      .delete()
      .lte('on_waivers_until', now.toISOString())
      .select('id, league_id, player_id');
    if (ewErr) throw ewErr;

    if (expiredWaivers && expiredWaivers.length > 0) {
      // Batch-fetch all leagues for expired waivers
      const leagueIds = [...new Set(expiredWaivers.map(w => w.league_id))];
      const { data: leaguesData } = await supabase
        .from('leagues').select('id, name, waiver_type, waiver_period_days')
        .in('id', leagueIds);
      const leagueMap = new Map((leaguesData ?? []).map(l => [l.id, l]));

      for (const waiver of expiredWaivers) {
        const league = leagueMap.get(waiver.league_id);

        if (!league || league.waiver_type !== 'standard') {
          // Already deleted atomically at Step A start — just skip processing
          continue;
        }

        const { data: claims } = await supabase
          .from('waiver_claims')
          .select('id, league_id, team_id, player_id, status, bid_amount, priority, created_at, drop_player_id')
          .eq('league_id', waiver.league_id).eq('player_id', waiver.player_id)
          .eq('status', 'pending')
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true });

        // Pre-fetch player + team names for all claims in this batch
        const claimPlayerIds = (claims ?? []).flatMap(c =>
          [c.player_id, c.drop_player_id].filter(Boolean) as string[]
        );
        const claimTeamIds = (claims ?? []).map(c => c.team_id);
        await Promise.all([
          resolvePlayerNames(claimPlayerIds),
          resolveTeamNames(claimTeamIds),
        ]);

        let awarded = false;

        for (const claim of claims ?? []) {
          try {
            const result = await checkAndProcessClaim(claim, waiver.league_id, league.waiver_period_days);
            if (result.ok) {
              awarded = true;
              await bumpWaiverPriority(waiver.league_id, claim.team_id);

              // Notify league about the waiver claim
              try {
                const ln = league.name ?? 'Your League';
                const tn = teamName(claim.team_id);
                let claimBody = `${tn} claimed ${playerName(claim.player_id)} off waivers`;
                if (claim.drop_player_id) claimBody += ` (dropped ${playerName(claim.drop_player_id)})`;
                await notifyLeague(supabase, waiver.league_id, 'roster_moves',
                  `${ln} — Waiver Claim`,
                  claimBody,
                  { screen: 'activity' }
                );
                // Also notify the winning team directly
                await notifyTeams(supabase, [claim.team_id], 'waivers',
                  `${ln} — Waiver Claim Successful`,
                  `You claimed ${playerName(claim.player_id)} off waivers!`,
                  { screen: 'roster' }
                );
              } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }

              await supabase.from('waiver_claims')
                .update({ status: 'failed', processed_at: now.toISOString() })
                .eq('league_id', waiver.league_id).eq('player_id', waiver.player_id)
                .eq('status', 'pending').neq('id', claim.id);

              // Notify losers
              const failedClaims = (claims ?? []).filter(c => c.id !== claim.id);
              for (const fc of failedClaims) {
                try {
                  const lnLost = league.name ?? 'Your League';
                  await notifyTeams(supabase, [fc.team_id], 'waivers',
                    `${lnLost} — Waiver Claim Lost`,
                    'Your waiver claim was not awarded.',
                    { screen: 'free-agents' }
                  );
                } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }
              }

              processed++;
              break;
            } else {
              // Notify team why their claim failed
              const ln = league.name ?? 'Your League';
              if (result.reason === 'roster_full' || result.reason === 'drop_player_unavailable' || result.reason === 'position_limit') {
                await supabase.from('waiver_claims')
                  .update({ status: 'failed', processed_at: now.toISOString() })
                  .eq('id', claim.id);
                const msg = result.reason === 'drop_player_unavailable'
                  ? `Your claim for ${playerName(claim.player_id)} failed: the player you selected to drop is no longer on your roster.`
                  : result.reason === 'position_limit'
                  ? `Your claim for ${playerName(claim.player_id)} failed: adding this player would exceed a position limit.`
                  : `Your claim for ${playerName(claim.player_id)} failed: roster is full. Select a player to drop when placing claims.`;
                try {
                  await notifyTeams(supabase, [claim.team_id], 'waivers',
                    `${ln} — Waiver Claim Failed`, msg, { screen: 'free-agents' }
                  );
                } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }
                failed++;
              }
              // 'already_owned' — skip silently, next claim may still succeed
            }
          } catch (err: any) {
            errors.push(`claim ${claim.id}: ${err.message}`);
            await supabase.from('waiver_claims')
              .update({ status: 'failed', processed_at: now.toISOString() })
              .eq('id', claim.id);
            failed++;
          }
        }

        // No need to delete league_waivers — already deleted atomically at Step A start
      }
    }
  } catch (err: any) {
    errors.push(`Step A error: ${err.message}`);
  }

  // Step B: Process FAAB Claims (weekly cycle)
  try {
    const { data: faabLeagues, error: flErr } = await supabase
      .from('leagues').select('id, name, waiver_day_of_week, waiver_period_days')
      .eq('waiver_type', 'faab');
    if (flErr) throw flErr;

    for (const league of faabLeagues ?? []) {
      if (league.waiver_day_of_week !== todayDow) continue;

      const { data: claims } = await supabase
        .from('waiver_claims')
        .select('id, league_id, team_id, player_id, status, bid_amount, priority, created_at, drop_player_id')
        .eq('league_id', league.id).eq('status', 'pending')
        .order('bid_amount', { ascending: false })
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });

      if (!claims || claims.length === 0) continue;

      // Pre-fetch all player + team names for this league's claims
      const allPlayerIds = claims.flatMap(c =>
        [c.player_id, c.drop_player_id].filter(Boolean) as string[]
      );
      const allClaimTeamIds = claims.map(c => c.team_id);
      await Promise.all([
        resolvePlayerNames(allPlayerIds),
        resolveTeamNames(allClaimTeamIds),
      ]);

      const byPlayer = new Map<string, typeof claims>();
      for (const claim of claims) {
        const existing = byPlayer.get(claim.player_id) ?? [];
        existing.push(claim);
        byPlayer.set(claim.player_id, existing);
      }

      const awardedPlayers = new Set<string>();

      for (const [playerId, playerClaims] of byPlayer) {
        let awarded = false;

        for (const claim of playerClaims) {
          if (awardedPlayers.has(playerId)) {
            await supabase.from('waiver_claims')
              .update({ status: 'failed', processed_at: now.toISOString() })
              .eq('id', claim.id);

            try {
              const ln = league.name ?? 'Your League';
              await notifyTeams(supabase, [claim.team_id], 'waivers',
                `${ln} — FAAB Bid Lost`,
                'Your bid was not the highest.',
                { screen: 'free-agents' }
              );
            } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }
            failed++;
            continue;
          }

          try {
            const result = await checkAndProcessClaim(claim, league.id, league.waiver_period_days);
            if (result.ok) {
              awarded = true;
              awardedPlayers.add(playerId);

              const { data: wp } = await supabase
                .from('waiver_priority').select('faab_remaining')
                .eq('league_id', league.id).eq('team_id', claim.team_id).single();

              if (wp) {
                await supabase.from('waiver_priority')
                  .update({ faab_remaining: Math.max(0, (wp.faab_remaining ?? 0) - claim.bid_amount) })
                  .eq('league_id', league.id).eq('team_id', claim.team_id);
              }

              // Notify league about the FAAB claim
              try {
                const ln = league.name ?? 'Your League';
                const tn = teamName(claim.team_id);
                let faabBody = `${tn} claimed ${playerName(claim.player_id)} for $${claim.bid_amount}`;
                if (claim.drop_player_id) faabBody += ` (dropped ${playerName(claim.drop_player_id)})`;
                await notifyLeague(supabase, league.id, 'roster_moves',
                  `${ln} — Waiver Claim`,
                  faabBody,
                  { screen: 'activity' }
                );
              } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }

              processed++;
            } else if (result.reason === 'roster_full' || result.reason === 'drop_player_unavailable' || result.reason === 'position_limit') {
              await supabase.from('waiver_claims')
                .update({ status: 'failed', processed_at: now.toISOString() })
                .eq('id', claim.id);
              try {
                const ln = league.name ?? 'Your League';
                const msg = result.reason === 'drop_player_unavailable'
                  ? `Your bid for ${playerName(claim.player_id)} failed: the player you selected to drop is no longer on your roster.`
                  : result.reason === 'position_limit'
                  ? `Your bid for ${playerName(claim.player_id)} failed: adding this player would exceed a position limit.`
                  : `Your bid for ${playerName(claim.player_id)} failed: roster is full. Select a player to drop when placing bids.`;
                await notifyTeams(supabase, [claim.team_id], 'waivers',
                  `${ln} — FAAB Bid Failed`, msg, { screen: 'free-agents' }
                );
              } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }
              failed++;
            }
          } catch (err: any) {
            errors.push(`FAAB claim ${claim.id}: ${err.message}`);
            await supabase.from('waiver_claims')
              .update({ status: 'failed', processed_at: now.toISOString() })
              .eq('id', claim.id);
            failed++;
          }
        }

        if (awarded) {
          await supabase.from('waiver_claims')
            .update({ status: 'failed', processed_at: now.toISOString() })
            .eq('league_id', league.id).eq('player_id', playerId).eq('status', 'pending');
        }
      }
    }
  } catch (err: any) {
    errors.push(`Step B error: ${err.message}`);
  }

  // Step C removed — expired league_waivers are now atomically deleted at Step A start

  return new Response(
    JSON.stringify({ ok: true, processed, failed, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

type ClaimResult = { ok: true } | { ok: false; reason: 'already_owned' | 'roster_full' | 'drop_player_unavailable' | 'position_limit' };

async function checkAndProcessClaim(claim: any, leagueId: string, waiverPeriodDays: number): Promise<ClaimResult> {
  const now = new Date();

  const { data: existing } = await supabase
    .from('league_players').select('id')
    .eq('league_id', leagueId).eq('player_id', claim.player_id).limit(1);
  if (existing && existing.length > 0) return { ok: false, reason: 'already_owned' };

  const [allRes, irRes, taxiRes, leagueRes] = await Promise.all([
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'IR'),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'TAXI'),
    supabase.from('leagues').select('roster_size, position_limits').eq('id', leagueId).single(),
  ]);

  const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0) - (taxiRes.count ?? 0);
  const maxSize = leagueRes.data?.roster_size ?? 13;
  const positionLimits = leagueRes.data?.position_limits as Record<string, number> | null;
  const rosterFull = activeCount >= maxSize;

  if (rosterFull && !claim.drop_player_id) return { ok: false, reason: 'roster_full' };

  if (claim.drop_player_id) {
    // Check if the drop player is still on this team (could have been traded/dropped already)
    const { data: dropCheck } = await supabase.from('league_players').select('id')
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('player_id', claim.drop_player_id).limit(1);

    if (dropCheck && dropCheck.length > 0 && rosterFull) {
      // Drop player exists and roster is full — execute the drop
      await snapshotBeforeDrop(supabase, leagueId, claim.team_id, claim.drop_player_id);

      const { error: delErr } = await supabase.from('league_players').delete()
        .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('player_id', claim.drop_player_id);
      if (delErr) throw delErr;

      if (waiverPeriodDays > 0) {
        const raw = new Date();
        raw.setDate(raw.getDate() + waiverPeriodDays);
        const until = new Date(Date.UTC(
          raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 6, 0, 0, 0
        ));
        if (raw.getTime() > until.getTime()) {
          until.setUTCDate(until.getUTCDate() + 1);
        }
        await supabase.from('league_waivers').insert({
          league_id: leagueId, player_id: claim.drop_player_id,
          on_waivers_until: until.toISOString(), dropped_by_team_id: claim.team_id,
        });
      }
    } else if (!dropCheck || dropCheck.length === 0) {
      // Drop player is gone — if roster is still full, fail; otherwise skip the drop and continue
      if (rosterFull) return { ok: false, reason: 'drop_player_unavailable' };
    }
  }

  // Re-count roster before inserting to prevent overflow from concurrent adds
  const [reAll, reIr, reTaxi] = await Promise.all([
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'IR'),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'TAXI'),
  ]);
  const reActive = (reAll.count ?? 0) - (reIr.count ?? 0) - (reTaxi.count ?? 0);
  if (reActive >= maxSize) return { ok: false, reason: 'roster_full' };

  // Use cached player name instead of fetching again
  const pName = playerName(claim.player_id);
  // Still need position for the insert - fetch only if not already cached via claims
  const { data: playerData } = await supabase
    .from('players').select('position').eq('id', claim.player_id).single();

  // Position limit check
  if (positionLimits && Object.keys(positionLimits).length > 0 && playerData?.position) {
    const { data: rosterForLimits } = await supabase
      .from('league_players')
      .select('position, roster_slot')
      .eq('league_id', leagueId)
      .eq('team_id', claim.team_id);
    const violation = checkPositionLimits(positionLimits, rosterForLimits ?? [], playerData.position);
    if (violation) return { ok: false, reason: 'position_limit' };
  }

  const { error: addErr } = await supabase.from('league_players').insert({
    league_id: leagueId, player_id: claim.player_id, team_id: claim.team_id,
    acquired_via: 'waiver', acquired_at: now.toISOString(),
    position: playerData?.position ?? 'UTIL',
    roster_slot: 'BE',
  });
  if (addErr) {
    // Unique constraint means another claim grabbed this player first
    if (addErr.code === '23505') return { ok: false, reason: 'already_owned' };
    throw addErr;
  }

  // Create daily_lineups entry so slot history is consistent from day one
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await supabase.from('daily_lineups').upsert({
    league_id: leagueId, team_id: claim.team_id, player_id: claim.player_id,
    lineup_date: todayStr, roster_slot: 'BE',
  }, { onConflict: 'team_id,player_id,lineup_date' });

  let notes = `Claimed ${pName} off waivers`;
  if (claim.bid_amount > 0) notes += ` ($${claim.bid_amount})`;

  if (claim.drop_player_id) {
    notes += ` (dropped ${playerName(claim.drop_player_id)})`;
  }

  const { data: txn } = await supabase
    .from('league_transactions').insert({ league_id: leagueId, type: 'waiver', notes, team_id: claim.team_id })
    .select('id').single();

  if (txn) {
    const items: any[] = [
      { transaction_id: txn.id, player_id: claim.player_id, team_to_id: claim.team_id },
    ];
    if (claim.drop_player_id) {
      items.push({ transaction_id: txn.id, player_id: claim.drop_player_id, team_from_id: claim.team_id });
    }
    await supabase.from('league_transaction_items').insert(items);
  }

  await supabase.from('waiver_claims')
    .update({ status: 'successful', processed_at: now.toISOString() })
    .eq('id', claim.id);

  return { ok: true };
}

async function bumpWaiverPriority(leagueId: string, winningTeamId: string) {
  const { data: allPriorities } = await supabase
    .from('waiver_priority').select('team_id, priority')
    .eq('league_id', leagueId).order('priority', { ascending: true });

  if (!allPriorities || allPriorities.length === 0) return;

  const winnerPriority = allPriorities.find(p => p.team_id === winningTeamId)?.priority;
  if (winnerPriority == null) return;

  // Batch all priority updates with Promise.all instead of sequential awaits
  const updates = allPriorities
    .filter(p => p.team_id === winningTeamId || p.priority > winnerPriority)
    .map(p => {
      const newPriority = p.team_id === winningTeamId ? allPriorities.length : p.priority - 1;
      return supabase.from('waiver_priority')
        .update({ priority: newPriority })
        .eq('league_id', leagueId).eq('team_id', p.team_id);
    });

  await Promise.all(updates);
}
