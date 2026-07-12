import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Receiver } from 'https://esm.sh/@upstash/qstash';
import { deferWork } from '../_shared/background.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { checkPositionLimits } from '../_shared/positionLimits.ts';
import { notifyTeams, notifyLeague } from '../_shared/push.ts';
import { effectiveTimeLimit } from '../_shared/draftClock.ts';
import { scheduleAutodraft, schedulePickReminder } from '../_shared/qstash.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { effectiveDraftPts } from '../../../utils/draft/draftRanking.ts';
import { formatPickClock, isSlowClock } from '../../../utils/draft/pickClock.ts';
import { isEligibleForSlot } from '../../../utils/roster/rosterSlotsShared.ts';
import { getSportModule } from '../../../utils/sports/registry.ts';

const Body = z.object({
  draft_id: z.string().uuid(),
  pick_number: z.number().int().positive(),
  autopick_triggered: z.boolean().optional(),
});

// Pure variant: takes pre-fetched roster config + current roster so the caller
// can batch the underlying queries with the rest of phase-2 reads.
function findBestSlot(
  configs: { position: string; slot_count: number }[],
  currentPlayers: { roster_slot: string | null }[],
  playerPosition: string,
): string {
  const occupiedSlots = new Set<string>(
    currentPlayers.map((p) => p.roster_slot ?? 'BE'),
  );

  const starterConfigs = configs.filter((c) => c.position !== 'BE' && c.position !== 'IR');
  for (const config of starterConfigs) {
    if (!isEligibleForSlot(playerPosition, config.position)) continue;
    if (config.position === 'UTIL') {
      for (let i = 1; i <= config.slot_count; i++) {
        const slot = `UTIL${i}`;
        if (!occupiedSlots.has(slot)) return slot;
      }
    } else {
      let filled = 0;
      for (const p of currentPlayers) {
        if (p.roster_slot === config.position) filled++;
      }
      if (filled < config.slot_count) return config.position;
    }
  }

  return 'BE';
}


Deno.serve(async (req) => {
  try {
    const receiver = new Receiver({
      currentSigningKey: Deno.env.get('QSTASH_CURRENT_SIGNING_KEY') ?? '',
      nextSigningKey: Deno.env.get('QSTASH_NEXT_SIGNING_KEY') ?? '',
    });

    const bodyText = await req.text();
    const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;

    try {
      await receiver.verify({
        signature: req.headers.get('Upstash-Signature') ?? '',
        body: bodyText,
        url: autodraftUrl,
      });
    } catch {
      return errorResponse('Unauthorized', 401);
    }

    const { draft_id, pick_number, autopick_triggered } = parseBody(Body, JSON.parse(bodyText));

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Phase 1: parallel fetch of draft + current pick (no inter-dependency).
    const [draftResult, pickResult] = await Promise.all([
      supabaseAdmin
        .from('drafts')
        .select('current_pick_number, rounds, picks_per_round, time_limit, accelerate_after_round, accelerated_time_limit, league_id, type, status')
        .eq('id', draft_id)
        .single(),
      supabaseAdmin
        .from('draft_picks')
        .select('id, current_team_id, player_id')
        .eq('draft_id', draft_id)
        .eq('pick_number', pick_number)
        .single(),
    ]);

    const { data: draft, error: draftError } = draftResult;
    if (draftError || !draft || draft.current_pick_number !== pick_number) {
      return jsonResponse({ message: 'Pick already made or draft not found' });
    }

    const { data: currentPick, error: pickError } = pickResult;
    if (pickError || !currentPick || currentPick.player_id) {
      return jsonResponse({ message: 'Pick already made' });
    }

    // Paused by the commissioner — this in-flight QStash timer dies harmlessly:
    // make NO pick and schedule NOTHING. resume-draft re-arms the clock from the
    // snapshotted remaining time. This guard MUST precede every mutation and the
    // autopick re-check below so a pause is a true no-op.
    if (draft.status === 'paused') {
      return jsonResponse({ message: 'Draft is paused' });
    }

    // Phase 2: parallel fetch of everything needed to choose the player and
    // assign a roster slot. None of these depend on each other once we have
    // draft.league_id + currentPick.current_team_id from phase 1.
    const [
      draftedResult,
      leagueResult,
      teamRosterResult,
      queueResult,
      teamStatusResult,
      rosterConfigResult,
    ] = await Promise.all([
      supabaseAdmin.from('league_players').select('player_id').eq('league_id', draft.league_id),
      supabaseAdmin.from('leagues').select('sport, position_limits, archived_at').eq('id', draft.league_id).single(),
      supabaseAdmin
        .from('league_players')
        .select('position, roster_slot')
        .eq('league_id', draft.league_id)
        .eq('team_id', currentPick.current_team_id),
      supabaseAdmin
        .from('draft_queue')
        .select('id, player_id')
        .eq('draft_id', draft_id)
        .eq('team_id', currentPick.current_team_id)
        .order('priority'),
      autopick_triggered
        ? supabaseAdmin
            .from('draft_team_status')
            .select('autopick_on')
            .eq('draft_id', draft_id)
            .eq('team_id', currentPick.current_team_id)
            .maybeSingle()
        : Promise.resolve({ data: null as { autopick_on: boolean } | null }),
      supabaseAdmin.from('league_roster_config').select('position, slot_count').eq('league_id', draft.league_id),
    ]);

    // League archived (soft-deleted) mid-draft — kill the self-perpetuating
    // QStash chain: make NO pick, schedule NOTHING, send NO push. Slow drafts
    // span days, so archive-mid-draft is realistic; without this the chain
    // auto-picks a deleted league to completion (its UI is already gone). This
    // is the same guard start-draft carries for the auto-start cron — a blind
    // trigger must check archived_at itself.
    if (leagueResult.data?.archived_at) {
      return jsonResponse({ message: 'League is archived; draft halted' });
    }

    // If this was triggered by the autopick toggle (not the normal draft clock),
    // re-check that the team still has autopick enabled — they may have toggled off.
    if (autopick_triggered && !teamStatusResult.data?.autopick_on) {
      // User turned off autopick before this fired — schedule normal clock instead
      const freshLimit = effectiveTimeLimit(pick_number, draft);
      await scheduleAutodraft(draft_id, pick_number, freshLimit);
      await schedulePickReminder(draft_id, pick_number, freshLimit);
      return jsonResponse({ message: 'Autopick cancelled, normal clock scheduled' });
    }

    const draftedIds = (draftedResult.data ?? []).map((p: { player_id: string }) => String(p.player_id));
    const isRookieDraft = draft.type === 'rookie';

    const sport: 'nba' | 'wnba' | 'nfl' =
      leagueResult.data?.sport === 'wnba' || leagueResult.data?.sport === 'nfl'
        ? leagueResult.data.sport
        : 'nba';
    const posLimits = leagueResult.data?.position_limits as Record<string, number> | null;
    const teamRoster: { position: string; roster_slot: string }[] = teamRosterResult.data ?? [];
    const useLimits = posLimits && Object.keys(posLimits).length > 0;
    const rosterConfigs = rosterConfigResult.data ?? [];

    // Check if the team has a draft queue — pick from it first
    let topPlayer: { player_id: string; position: string } | null = null;
    let usedQueueEntryId: string | null = null;

    const queueEntries = queueResult.data ?? [];

    if (queueEntries.length > 0) {
      // Batch player_season_stats for the whole queue in one round-trip instead
      // of N sequential .single() lookups.
      const queuePlayerIds = queueEntries.map((e: { player_id: string }) => e.player_id);
      const { data: queuePlayerStats } = await supabaseAdmin
        .from('player_season_stats')
        .select('player_id, position')
        .in('player_id', queuePlayerIds);
      const statsByPlayerId = new Map<string, { player_id: string; position: string }>(
        (queuePlayerStats ?? []).map((s: { player_id: string; position: string }) => [String(s.player_id), s]),
      );

      // Find first queued player that is still available and passes position limits
      for (const entry of queueEntries) {
        if (draftedIds.includes(String(entry.player_id))) continue;
        const playerStats = statsByPlayerId.get(String(entry.player_id));
        if (!playerStats) continue;
        if (useLimits) {
          const violation = checkPositionLimits(posLimits!, teamRoster, playerStats.position);
          if (violation) continue;
        }
        topPlayer = playerStats;
        usedQueueEntryId = entry.id;
        break;
      }
    }

    // Fall back to best available by effective draft value. `pro_team IS NOT
    // NULL` works year-round; `games_played > 0` would yield an empty pool
    // during the offseason — except for rookie drafts which override below.
    if (!topPlayer) {
      // Ranking by current-season avg_pts alone breaks pre-tipoff: every
      // current avg_pts is NULL, and `ORDER BY avg_pts DESC` puts NULLs FIRST,
      // so the old `.limit(20)` returned 20 statless fringe players. Instead we
      // pull the whole pool and rank in JS by effectiveDraftPts (current avg
      // once a player has enough games this season, else season projection,
      // else last-season production) — mirroring the human board in
      // components/draft/AvailablePlayers via the shared draftRanking helper.
      let candidateQuery = supabaseAdmin
        .from('player_season_stats')
        .select('player_id, position, avg_pts, games_played')
        .eq('sport', sport)
        // NULLS LAST so statless rows never sort above real production.
        .order('avg_pts', { ascending: false, nullsFirst: false });

      if (isRookieDraft) {
        candidateQuery = candidateQuery.eq('rookie', true);
      } else {
        candidateQuery = candidateQuery.not('pro_team', 'is', null);
      }

      if (draftedIds.length > 0) {
        candidateQuery = candidateQuery.filter('player_id', 'not.in', `(${draftedIds.join(',')})`);
      }

      // Current season (live, from season_config) pins the season-horizon
      // projections — that view also carries next-year rows — and derives the
      // previous season label for the last-season fallback (WNBA/NFL "2026" →
      // "2025"; NBA "2025-26" → "2024-25", matching constants/LeagueDefaults).
      const { data: seasonRow } = await supabaseAdmin
        .from('season_config')
        .select('season')
        .eq('sport', sport)
        .eq('is_current', true)
        .maybeSingle();
      const singleYear = getSportModule(sport).seasonFormat === 'single-year';
      const currentSeason = seasonRow?.season ?? (singleYear ? '2026' : '2025-26');
      const prevStartYear = parseInt(currentSeason.split('-')[0], 10) - 1;
      const previousSeason = singleYear
        ? String(prevStartYear)
        : `${prevStartYear}-${String((prevStartYear + 1) % 100).padStart(2, '0')}`;

      const [candidatesRes, projRes, histRes] = await Promise.all([
        candidateQuery,
        supabaseAdmin
          .from('current_player_projections')
          .select('player_id, proj_pts')
          .eq('sport', sport)
          .eq('horizon', 'season')
          .eq('season', currentSeason),
        supabaseAdmin
          .from('player_historical_stats')
          .select('player_id, avg_pts')
          .eq('sport', sport)
          .eq('season', previousSeason),
      ]);

      const { data: candidates, error: playerError } = candidatesRes;
      if (playerError || !candidates || candidates.length === 0) {
        return jsonResponse({ message: 'No players available' });
      }

      const projByPlayer = new Map<string, number>(
        (projRes.data ?? []).map((r: { player_id: string; proj_pts: number | null }) =>
          [String(r.player_id), Number(r.proj_pts) || 0]),
      );
      const histByPlayer = new Map<string, number>(
        (histRes.data ?? []).map((r: { player_id: string; avg_pts: number | null }) =>
          [String(r.player_id), Number(r.avg_pts) || 0]),
      );

      const draftValue = (c: { player_id: string; avg_pts: number | null; games_played: number | null }) =>
        effectiveDraftPts({
          gamesPlayed: c.games_played,
          currentAvgPts: c.avg_pts,
          seasonProjPts: projByPlayer.get(String(c.player_id)),
          lastSeasonAvgPts: histByPlayer.get(String(c.player_id)),
        });

      // Highest effective value first.
      const ranked = [...candidates].sort((a, b) => draftValue(b) - draftValue(a));

      // Pick the best-ranked player that passes position limits.
      for (const candidate of ranked) {
        if (useLimits) {
          const violation = checkPositionLimits(posLimits!, teamRoster, candidate.position);
          if (violation) continue;
        }
        topPlayer = candidate;
        break;
      }
      // Fallback: if all candidates violate limits, draft the best anyway to prevent deadlock
      if (!topPlayer) topPlayer = ranked[0];
    }

    const rosterSlot = findBestSlot(rosterConfigs, teamRoster, topPlayer.position);
    const nextPickNumber = pick_number + 1;
    // Effective clock for the new current pick (honors round acceleration).
    const nextLimit = effectiveTimeLimit(nextPickNumber, draft);

    // Claim + roster-add + queue-cleanup + draft-advance in ONE transaction.
    // The pick claim is guarded (player_id IS NULL) INSIDE the txn, so a
    // mid-sequence failure rolls the claim back (no permanently-stuck draft) and
    // two concurrent deliveries (a late QStash message racing the stalled-draft
    // sweeper's republish, or an autopick racing a human) serialize on the row
    // lock — the loser matches 0 rows and returns claimed=false without writing.
    const { data: claimData, error: rpcError } = await supabaseAdmin.rpc('execute_autodraft_pick', {
      p_draft_id: draft_id,
      p_pick_number: pick_number,
      p_player_id: topPlayer.player_id,
      p_league_id: draft.league_id,
      p_team_id: currentPick.current_team_id,
      p_roster_slot: rosterSlot,
      p_player_position: topPlayer.position,
      p_is_rookie_draft: isRookieDraft,
      p_next_time_limit: nextLimit,
      p_used_queue_entry_id: usedQueueEntryId,
    });
    if (rpcError) {
      // Cross-pick race: the same player was rostered by another pick first
      // (uq_league_player). This pick's txn rolled back, so leave it for the
      // stalled-draft sweeper to re-fire rather than 500-ing.
      if ((rpcError as { code?: string }).code === '23505') {
        return jsonResponse({ message: 'Player already drafted; pick will be retried' });
      }
      throw rpcError;
    }
    const claim = claimData as { claimed?: boolean; is_complete?: boolean } | null;
    if (!claim?.claimed) {
      return jsonResponse({ message: 'Pick already made' });
    }

    const isDraftComplete = claim.is_complete === true;

    // Defer non-critical work (scheduling the next pick, push notifications) so
    // the function can return immediately after the atomic RPC above. These were
    // already wrapped in non-fatal try/catch, so the failure semantics are
    // unchanged — we just stop blocking the response on them.
    deferWork((async () => {
      // Schedule next pick + collect data needed for both that and the
      // "your turn" push in a single fetch.
      let nextPickTeamId: string | null = null;
      if (!isDraftComplete) {
        try {
          const { data: nextPick } = await supabaseAdmin
            .from('draft_picks')
            .select('current_team_id')
            .eq('draft_id', draft_id)
            .eq('pick_number', nextPickNumber)
            .single();
          nextPickTeamId = nextPick?.current_team_id ?? null;

          let delay = nextLimit;
          let nextIsAutopick = false;
          if (nextPickTeamId) {
            const { data: teamStatus } = await supabaseAdmin
              .from('draft_team_status')
              .select('autopick_on')
              .eq('draft_id', draft_id)
              .eq('team_id', nextPickTeamId)
              .maybeSingle();

            if (teamStatus?.autopick_on) {
              delay = 1;
              nextIsAutopick = true;
            }
          }

          await scheduleAutodraft(draft_id, nextPickNumber, delay, nextIsAutopick);
          // Slow drafts: warn the next picker before their clock runs out.
          if (!nextIsAutopick) {
            await schedulePickReminder(draft_id, nextPickNumber, nextLimit);
          }
        } catch (schedErr) {
          console.warn('Failed to schedule next autodraft (non-fatal):', schedErr);
        }
      }

      // Push notifications
      try {
        const [{ data: playerInfo }, { data: leagueInfo }] = await Promise.all([
          supabaseAdmin.from('players').select('name').eq('id', topPlayer!.player_id).single(),
          supabaseAdmin.from('leagues').select('name').eq('id', draft.league_id).single(),
        ]);
        const ln = leagueInfo?.name ?? 'Your League';

        await notifyTeams(supabaseAdmin, [currentPick.current_team_id], 'draft',
          `${ln} — Autopick Made`,
          `${playerInfo?.name ?? 'A player'} was auto-drafted for your team.`,
          { screen: 'draft-room', draft_id }
        );

        if (!isDraftComplete && nextPickTeamId) {
          await notifyTeams(supabaseAdmin, [nextPickTeamId], 'draft',
            `${ln} — Your turn to pick!`,
            isSlowClock(nextLimit)
              ? `You're on the clock — you have ${formatPickClock(nextLimit)} to pick.`
              : 'The draft clock is ticking. Make your pick.',
            { screen: 'draft-room', draft_id }
          );
        } else if (isDraftComplete) {
          await notifyLeague(supabaseAdmin, draft.league_id, 'draft',
            isRookieDraft ? `${ln} — Rookie Draft Complete!` : `${ln} — Draft Complete!`,
            isRookieDraft
              ? 'The rookie draft has finished. Check your new players.'
              : 'Your league\'s draft has finished. Check your roster.',
            { screen: 'roster' }
          );
        }
      } catch (notifyErr) {
        console.warn('Push notification failed (non-fatal):', notifyErr);
      }
    })());

    return jsonResponse({ message: isDraftComplete ? 'Draft complete!' : 'Autodrafted!' });
  } catch (error) {
    return handleError(error, 'autodraft');
  }
});
