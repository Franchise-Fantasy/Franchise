import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { createLogger } from '../_shared/log.ts';
import { checkPositionLimits } from '../_shared/positionLimits.ts';
import { notifyTeams, notifyLeague, notifyTeamsBulk, type BulkTeamsNotification } from '../_shared/push.ts';
import { snapshotBeforeDrop } from '../_shared/snapshotBeforeDrop.ts';

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
    return errorResponse('Unauthorized', 401);
  }

  const now = new Date();
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Resolve expired waivers for BOTH standard and FAAB leagues. Every dropped
  // player sits on its own per-player clock (`on_waivers_until`); when it
  // expires we resolve that player's pending claims by the league's waiver
  // type — standard by priority, FAAB by highest bid. A player that clears
  // with no pending claims simply becomes a free agent (its row is gone).
  // Atomically claim expired waivers by deleting them upfront — if two cron
  // invocations overlap, only one gets each row (DELETE is atomic).
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
      // Archived leagues bypass RLS here (service role); a deleted league must
      // not have its waivers processed. Filtered out → `if (!league) continue`
      // below clears the expired row to free agency without notifying.
      const { data: leaguesData } = await supabase
        .from('leagues').select('id, name, waiver_type, faab_tiebreak')
        .in('id', leagueIds)
        .is('archived_at', null);
      const leagueMap = new Map((leaguesData ?? []).map(l => [l.id, l]));

      for (const waiver of expiredWaivers) {
        const league = leagueMap.get(waiver.league_id);

        if (!league || (league.waiver_type !== 'standard' && league.waiver_type !== 'faab')) {
          // No-waiver league or already-removed row — player clears to free agency.
          continue;
        }
        const isFaab = league.waiver_type === 'faab';

        // FAAB resolves by highest bid. An exact bid tie breaks by the league's
        // faab_tiebreak setting: 'waiver_priority' (better priority wins) or the
        // default 'earliest_bid' (first submitted wins). Standard leagues resolve
        // by waiver priority, then submission order.
        const faabTieByPriority = isFaab && league.faab_tiebreak === 'waiver_priority';
        const baseQuery = supabase
          .from('waiver_claims')
          .select('id, league_id, team_id, player_id, status, bid_amount, priority, created_at, drop_player_id')
          .eq('league_id', waiver.league_id).eq('player_id', waiver.player_id)
          .eq('status', 'pending');
        let orderedQuery;
        if (isFaab) {
          orderedQuery = faabTieByPriority
            ? baseQuery
                .order('bid_amount', { ascending: false })
                .order('priority', { ascending: true })
                .order('created_at', { ascending: true })
            : baseQuery
                .order('bid_amount', { ascending: false })
                .order('created_at', { ascending: true });
        } else {
          orderedQuery = baseQuery
            .order('priority', { ascending: true })
            .order('created_at', { ascending: true });
        }
        const { data: claims } = await orderedQuery;

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
            const result = await checkAndProcessClaim(claim, waiver.league_id, isFaab);
            if (result.ok) {
              awarded = true;
              // The award, the cost (FAAB debit / waiver-priority rotation), and
              // marking the losing claims all committed atomically inside
              // award_waiver_claim. Only notifications remain out here.

              // Notify league about the awarded claim/bid
              try {
                const ln = league.name ?? 'Your League';
                const tn = teamName(claim.team_id);
                let claimBody = isFaab
                  ? `${tn} claimed ${playerName(claim.player_id)} for $${claim.bid_amount}`
                  : `${tn} claimed ${playerName(claim.player_id)} off waivers`;
                if (claim.drop_player_id) claimBody += ` (dropped ${playerName(claim.drop_player_id)})`;
                await notifyLeague(supabase, waiver.league_id, 'roster_moves',
                  `${ln} — Waiver Claim`,
                  claimBody,
                  { screen: 'activity' }
                );
                // Also notify the winning team directly
                await notifyTeams(supabase, [claim.team_id], 'waivers',
                  `${ln} — ${isFaab ? 'FAAB Bid Won' : 'Waiver Claim Successful'}`,
                  isFaab
                    ? `You won ${playerName(claim.player_id)} for $${claim.bid_amount}!`
                    : `You claimed ${playerName(claim.player_id)} off waivers!`,
                  { screen: 'roster' }
                );
              } catch (err) { log.warn('Notification failed (non-fatal)', { error: String(err) }); }

              // Losing claims for this player were marked 'failed' inside
              // award_waiver_claim; the notification list is derived in-memory below.

              // Notify losers (bulk — single round trip rather than N sequential)
              const failedClaims = (claims ?? []).filter(c => c.id !== claim.id);
              if (failedClaims.length > 0) {
                try {
                  const lnLost = league.name ?? 'Your League';
                  await notifyTeamsBulk(supabase, 'waivers', failedClaims.map(fc => ({
                    teamIds: [fc.team_id],
                    title: `${lnLost} — ${isFaab ? 'FAAB Bid Lost' : 'Waiver Claim Lost'}`,
                    body: isFaab ? 'Your bid did not win.' : 'Your waiver claim was not awarded.',
                    data: { screen: 'free-agents' },
                  })));
                } catch (err) { log.warn('Bulk notification failed (non-fatal)', { error: String(err) }); }
              }

              processed++;
              break;
            } else {
              // Notify team why their claim/bid failed
              const ln = league.name ?? 'Your League';
              if (result.reason === 'roster_full' || result.reason === 'drop_player_unavailable' || result.reason === 'position_limit') {
                await supabase.from('waiver_claims')
                  .update({ status: 'failed', processed_at: now.toISOString() })
                  .eq('id', claim.id);
                const word = isFaab ? 'bid' : 'claim';
                const msg = result.reason === 'drop_player_unavailable'
                  ? `Your ${word} for ${playerName(claim.player_id)} failed: the player you selected to drop is no longer on your roster.`
                  : result.reason === 'position_limit'
                  ? `Your ${word} for ${playerName(claim.player_id)} failed: adding this player would exceed a position limit.`
                  : `Your ${word} for ${playerName(claim.player_id)} failed: roster is full. Select a player to drop when placing ${isFaab ? 'bids' : 'claims'}.`;
                try {
                  await notifyTeams(supabase, [claim.team_id], 'waivers',
                    `${ln} — ${isFaab ? 'FAAB Bid Failed' : 'Waiver Claim Failed'}`, msg, { screen: 'free-agents' }
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

        // No need to delete league_waivers — already deleted atomically upfront
      }
    }
  } catch (err: any) {
    errors.push(`Waiver resolution error: ${err.message}`);
  }

  return jsonResponse({ ok: true, processed, failed, errors });
});

type ClaimResult = { ok: true } | { ok: false; reason: 'already_owned' | 'roster_full' | 'drop_player_unavailable' | 'position_limit' };

async function checkAndProcessClaim(claim: any, leagueId: string, isFaab: boolean): Promise<ClaimResult> {
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

  // Decide whether to actually execute the drop. The drop only happens when the
  // roster is full AND the drop player is still on this team; if the roster isn't
  // full the drop_player_id is ignored (add without dropping), and if the drop
  // player is already gone while the roster is full the claim fails.
  let executeDrop = false;
  if (claim.drop_player_id) {
    const { data: dropCheck } = await supabase.from('league_players').select('id')
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('player_id', claim.drop_player_id).limit(1);
    const dropPresent = !!dropCheck && dropCheck.length > 0;
    if (dropPresent && rosterFull) {
      executeDrop = true;
    } else if (!dropPresent && rosterFull) {
      return { ok: false, reason: 'drop_player_unavailable' };
    }
    // dropPresent && !rosterFull → add without dropping (executeDrop stays false)
  }

  // Re-count before the award to guard against overflow from concurrent adds. The
  // drop (when executed) happens inside the RPC, so subtract it here to reflect
  // the post-drop active count the original checked against.
  const [reAll, reIr, reTaxi] = await Promise.all([
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'IR'),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'TAXI'),
  ]);
  let reActive = (reAll.count ?? 0) - (reIr.count ?? 0) - (reTaxi.count ?? 0);
  if (executeDrop) reActive -= 1;
  if (reActive >= maxSize) return { ok: false, reason: 'roster_full' };

  const pName = playerName(claim.player_id);
  const { data: playerData } = await supabase
    .from('players').select('position').eq('id', claim.player_id).single();

  // Position limit check. The drop (when executed) now happens inside the RPC, so
  // the roster we read here still contains the dropped player — exclude them, or a
  // legitimate same-position drop-and-add would be falsely rejected. This mirrors
  // the original ordering, where the drop landed before this check ran.
  if (positionLimits && Object.keys(positionLimits).length > 0 && playerData?.position) {
    const { data: rosterForLimits } = await supabase
      .from('league_players')
      .select('position, roster_slot, player_id')
      .eq('league_id', leagueId)
      .eq('team_id', claim.team_id);
    const effectiveRoster = (rosterForLimits ?? []).filter(
      (r: { player_id: string }) => !executeDrop || r.player_id !== claim.drop_player_id,
    );
    const violation = checkPositionLimits(positionLimits, effectiveRoster, playerData.position);
    if (violation) return { ok: false, reason: 'position_limit' };
  }

  // Snapshot the dropped player's lineup BEFORE the atomic award (idempotent; if
  // the RPC later rolls back, the player simply stays rostered and the snapshot
  // is harmless). Compute when the dropped player clears waivers.
  let dropWaiverUntil: string | null = null;
  if (executeDrop) {
    await snapshotBeforeDrop(supabase, leagueId, claim.team_id, claim.drop_player_id);
    // `waiver_until` owns the cadence for every writer of league_waivers
    // (basketball: rollover + period; NFL: the weekly Wednesday clear). For an
    // NFL league that means the player this claim drops joins NEXT week's run
    // rather than clearing mid-week — which is the whole point of one run.
    const { data: until } = await supabase.rpc('waiver_until', { p_league_id: leagueId });
    dropWaiverUntil = (until as string | null) ?? null;
  }

  let notes = `Claimed ${pName} off waivers`;
  if (claim.bid_amount > 0) notes += ` ($${claim.bid_amount})`;
  if (claim.drop_player_id) notes += ` (dropped ${playerName(claim.drop_player_id)})`;

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Commit the drop, award, daily_lineups, transaction + items, claim-status
  // flip, the cost (FAAB debit / priority rotation), and mark-losers as ONE
  // transaction — closing the award↔cost atomicity gap that could award a player
  // for free / leave a standard winner with top priority.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('award_waiver_claim', {
    p_claim_id: claim.id,
    p_league_id: leagueId,
    p_player_id: claim.player_id,
    p_team_id: claim.team_id,
    p_position: playerData?.position ?? 'UTIL',
    p_bid_amount: claim.bid_amount ?? 0,
    p_is_faab: isFaab,
    p_drop_player_id: claim.drop_player_id ?? null,
    p_execute_drop: executeDrop,
    p_drop_waiver_until: dropWaiverUntil,
    p_notes: notes,
    p_now: now.toISOString(),
    p_today: todayStr,
  });
  if (rpcErr) {
    // Unique constraint means another claim/add grabbed this player first.
    if ((rpcErr as { code?: string }).code === '23505') return { ok: false, reason: 'already_owned' };
    throw rpcErr;
  }
  if (rpcResult && (rpcResult as { ok?: boolean }).ok === false) {
    return { ok: false, reason: 'already_owned' };
  }

  return { ok: true };
}
