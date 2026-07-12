// finalize-week — runs at slate rollover (~5am ET) and finalizes any league
// matchup whose week.end_date < today. For each finalized matchup it writes
// scores, marks winners, increments W/L on `teams`, refreshes streaks, and
// (if all regular-season weeks are done) kicks off generate-playoff-round.
//
// Cron-secret gated. Idempotent via:
//   - atomic UPDATE ... SET is_finalized=true claim (only one concurrent
//     invocation succeeds per matchup)
//   - `stats_flushed` marker on league_matchups so a crash-recovery re-run
//     replays scores/streaks but skips W/L double-counting
//
// PR 10: scoring helpers + team computation extracted to
// _shared/finalizeWeek/. Per-team data is now loaded in a single batched
// prefetch (loadTeamDataBatch) instead of 4 queries × 2 teams × N matchups —
// for a 12-team league finalizing a 6-matchup week, that's 4 DB roundtrips
// instead of 48.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import type { Database, Json } from '../../../types/database.types.ts';
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { createLogger } from '../_shared/log.ts';
import { notifyTeams, notifyLeague } from '../_shared/push.ts';
import { getArchivedLeagueIds } from '../_shared/archivedLeagues.ts';

import {
  loadTeamDataBatch,
  teamDataKey,
  type MatchupTeamRef,
} from '../_shared/finalizeWeek/dataLoader.ts';
import {
  calcRounds,
  compareCategoryStats,
  extractBestDay,
  type CategoryResult,
  type PlayerScoreEntry,
  type ScoringWeight,
} from '../_shared/finalizeWeek/scoring.ts';
import {
  computeTeamCategoryStats,
  computeTeamScore,
} from '../_shared/finalizeWeek/teamScoring.ts';

const log = createLogger('finalize-week');

const supabase = createClient<Database>(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SB_SECRET_KEY')!,
);

// Recompute teams.streak by walking the most recent finalized matchups and
// counting consecutive wins/losses/ties from newest-first. Mirrors the
// previous in-file implementation.
async function computeStreak(teamId: string, leagueId: string): Promise<string> {
  const { data: matchups } = await supabase
    .from('league_matchups')
    .select('home_team_id, away_team_id, winner_team_id, week_number')
    .eq('league_id', leagueId)
    .eq('is_finalized', true)
    .is('playoff_round', null)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('week_number', { ascending: false })
    .limit(20);

  if (!matchups || matchups.length === 0) return '';

  let result: 'W' | 'L' | 'T' | null = null;
  let count = 0;
  for (const m of matchups) {
    let r: 'W' | 'L' | 'T';
    if (m.winner_team_id === null) r = 'T';
    else if (m.winner_team_id === teamId) r = 'W';
    else r = 'L';
    if (result === null) {
      result = r;
      count = 1;
    } else if (r === result) {
      count++;
    } else {
      break;
    }
  }
  return result ? `${result}${count}` : '';
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    // ── Recovery for legacy orphans (is_finalized=true, stats_flushed=false) ──
    // finalize_matchup_atomic now claims + scores + counts W/L in ONE transaction,
    // so this state can no longer be produced. It survives only to heal rows left
    // behind by the old multi-step path (or a hand edit).
    //
    // FIRST: un-finalize any orphan that was never actually SCORED. home_score and
    // away_score are NOT NULL DEFAULT 0, so an unscored row is indistinguishable
    // from a real 0-0 tie by score alone — the old recovery therefore flushed it as
    // a 0-0 TIE and the true result was lost forever. home_player_scores is nullable
    // and is only ever written by the scoring pass, so it is the reliable "was this
    // scored?" discriminator. Resetting is_finalized lets the normal path below
    // re-score the matchup correctly on this very run.
    const { data: unscored, error: unscoredErr } = await supabase
      .from('league_matchups')
      .update({ is_finalized: false })
      .eq('is_finalized', true)
      .eq('stats_flushed', false)
      .is('home_player_scores', null)
      .not('away_team_id', 'is', null)
      .select('id');
    if (unscoredErr) throw unscoredErr;
    if (unscored && unscored.length > 0) {
      log.warn('Recovery: un-finalized claimed-but-unscored matchups for re-scoring', {
        count: unscored.length,
      });
    }

    // Byes were claimed but never scored (no opponent) — just mark them flushed.
    await supabase
      .from('league_matchups')
      .update({ stats_flushed: true })
      .eq('is_finalized', true)
      .eq('stats_flushed', false)
      .is('away_team_id', null);

    // What's left is genuinely scored but never counted — apply its W/L. PF/PA is
    // recomputed absolutely below, so pass 0 here to avoid double-counting.
    const { data: orphaned } = await supabase
      .from('league_matchups')
      .select('id, league_id, home_team_id, away_team_id, home_score, away_score, winner_team_id, playoff_round, home_category_wins, away_category_wins, schedule_id')
      .eq('is_finalized', true)
      .eq('stats_flushed', false);

    if (orphaned && orphaned.length > 0) {
      const recoveryStats: Array<{ p_team_id: string; p_wins: number; p_losses: number; p_ties: number; p_pf: number; p_pa: number }> = [];
      const recoveryScores: Array<{ league_id: string; schedule_id: string; team_id: string; score: number; updated_at: string }> = [];
      const recoveryTeams = new Set<string>();
      const recoveryTeamLeague = new Map<string, string>();
      const now = new Date().toISOString();

      for (const m of orphaned) {
        if (m.away_team_id === null) continue;
        recoveryScores.push(
          { league_id: m.league_id, schedule_id: m.schedule_id, team_id: m.home_team_id, score: Number(m.home_score ?? 0), updated_at: now },
          { league_id: m.league_id, schedule_id: m.schedule_id, team_id: m.away_team_id, score: Number(m.away_score ?? 0), updated_at: now },
        );

        if (m.playoff_round != null) continue;

        if (m.winner_team_id === m.home_team_id) {
          recoveryStats.push(
            { p_team_id: m.home_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
            { p_team_id: m.away_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
          );
        } else if (m.winner_team_id === m.away_team_id) {
          recoveryStats.push(
            { p_team_id: m.away_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
            { p_team_id: m.home_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
          );
        } else {
          recoveryStats.push(
            { p_team_id: m.home_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
            { p_team_id: m.away_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
          );
        }
        recoveryTeams.add(m.home_team_id);
        recoveryTeams.add(m.away_team_id);
        recoveryTeamLeague.set(m.home_team_id, m.league_id);
        recoveryTeamLeague.set(m.away_team_id, m.league_id);
      }

      if (recoveryScores.length > 0) {
        await supabase.from('week_scores').upsert(recoveryScores, { onConflict: 'league_id,schedule_id,team_id' });
      }
      if (recoveryStats.length > 0) {
        await Promise.all(recoveryStats.map((params) => supabase.rpc('increment_team_stats', params)));
        await Promise.all([...recoveryTeams].map(async (teamId) => {
          const lid = recoveryTeamLeague.get(teamId)!;
          const streak = await computeStreak(teamId, lid);
          await supabase.from('teams').update({ streak }).eq('id', teamId);
        }));
      }
      await supabase.from('league_matchups').update({ stats_flushed: true }).in('id', orphaned.map((m) => m.id));
      log.info('Recovery: flushed stats for orphaned matchups', { orphaned_count: orphaned.length });
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: pendingWeeks, error: weekErr } = await supabase
      .from('league_schedule')
      .select('id, league_id, week_number, start_date, end_date, is_playoff')
      .lt('end_date', today);
    if (weekErr) throw weekErr;
    if (!pendingWeeks || pendingWeeks.length === 0) {
      return jsonResponse({ ok: true, finalized: 0, message: 'No completed weeks found' });
    }

    // Skip archived (soft-deleted) leagues. Service role bypasses RLS, so filter
    // their weeks out BEFORE the atomic claim below — otherwise their matchups
    // get marked is_finalized and are then never scored or flushed.
    const archivedLeagueIds = await getArchivedLeagueIds(supabase);
    const activeWeeks = pendingWeeks.filter((w) => !archivedLeagueIds.has(w.league_id));
    if (activeWeeks.length === 0) {
      return jsonResponse({ ok: true, finalized: 0, message: 'No completed weeks found' });
    }

    const scheduleIds = activeWeeks.map((w) => w.id);
    const scheduleMap = new Map(activeWeeks.map((w) => [w.id, w]));

    // READ (no claim). The claim now happens per-matchup inside
    // finalize_matchup_atomic, AFTER the score is computed — claiming up front is
    // what allowed a crash to leave a matchup finalized-but-unscored, which the old
    // recovery then flushed as a permanent 0-0 tie.
    const { data: candidateMatchups, error: matchErr } = await supabase
      .from('league_matchups')
      .select('id, league_id, schedule_id, week_number, home_team_id, away_team_id, playoff_round')
      .in('schedule_id', scheduleIds)
      .eq('is_finalized', false);
    if (matchErr) throw matchErr;
    if (!candidateMatchups || candidateMatchups.length === 0) {
      return jsonResponse({ ok: true, finalized: 0, message: 'All matchups already finalized' });
    }

    // Byes have no opponent, score, or W/L — nothing to make atomic, so finalize
    // them in one bulk statement and drop them from the scoring set.
    const byeIds = candidateMatchups.filter((m) => m.away_team_id === null).map((m) => m.id);
    if (byeIds.length > 0) {
      await supabase
        .from('league_matchups')
        .update({ is_finalized: true, stats_flushed: true })
        .in('id', byeIds);
    }

    const unfinalizedMatchups = candidateMatchups.filter((m) => m.away_team_id !== null);
    if (unfinalizedMatchups.length === 0) {
      return jsonResponse({ ok: true, finalized: byeIds.length, message: 'Only byes to finalize' });
    }

    // Bench any over-capacity active lineup rows for the weeks being finalized
    // before scoring, so a duplicate seat (two players stamped into one slot —
    // the data-integrity bug) can't inflate the finalized score. Idempotent and
    // normally a no-op; warn-and-continue so a hiccup never blocks finalize.
    // (dedup_active_lineup_slots — 20260629000001.)
    const finalizingWeeks = [...new Set(unfinalizedMatchups.map((m) => m.schedule_id))]
      .map((id) => scheduleMap.get(id))
      .filter((w): w is NonNullable<typeof w> => w != null);
    if (finalizingWeeks.length > 0) {
      const minStart = finalizingWeeks.reduce((m, w) => (w.start_date < m ? w.start_date : m), finalizingWeeks[0].start_date);
      const maxEnd = finalizingWeeks.reduce((m, w) => (w.end_date > m ? w.end_date : m), finalizingWeeks[0].end_date);
      const { error: dedupErr } = await supabase.rpc('dedup_active_lineup_slots', {
        p_start_date: minStart,
        p_end_date: maxEnd,
      });
      if (dedupErr) log.warn('dedup_active_lineup_slots failed; scoring may include a duplicate seat', { error: dedupErr.message });
    }

    // ── Bulk-load per-league scoring config in parallel (1 round-trip per league). ──
    const leagueIds = [...new Set(unfinalizedMatchups.map((m) => m.league_id))];
    const scoringByLeague = new Map<string, ScoringWeight[]>();
    const scoringTypeByLeague = new Map<string, string>();
    const sportByLeague = new Map<string, string>();
    await Promise.all(leagueIds.map(async (lid) => {
      const [{ data: scoring }, { data: leagueRow }] = await Promise.all([
        supabase.from('league_scoring_settings').select('stat_name, point_value, is_enabled, inverse').eq('league_id', lid),
        supabase.from('leagues').select('scoring_type, sport').eq('id', lid).single(),
      ]);
      scoringByLeague.set(lid, (scoring ?? []) as ScoringWeight[]);
      scoringTypeByLeague.set(lid, leagueRow?.scoring_type ?? 'points');
      sportByLeague.set(lid, leagueRow?.sport ?? 'nba');
    }));

    // ── BULK-LOAD all team data up front (PR 10's N+1 fix). ──
    // Build (team, league, week) refs for every team in every matchup; load
    // rosters + lineups + game logs + player info in 4 queries total, then
    // hand the indexed slice to computeTeamScore / computeTeamCategoryStats.
    const teamRefs: MatchupTeamRef[] = [];
    for (const m of unfinalizedMatchups) {
      if (m.away_team_id === null) continue;
      const w = scheduleMap.get(m.schedule_id);
      if (!w) continue;
      teamRefs.push({ teamId: m.home_team_id, leagueId: m.league_id, startDate: w.start_date, endDate: w.end_date });
      teamRefs.push({ teamId: m.away_team_id, leagueId: m.league_id, startDate: w.start_date, endDate: w.end_date });
    }
    const teamDataMap = await loadTeamDataBatch(supabase, teamRefs);

    const affectedTeams = new Set<string>();
    const teamLeagueMap = new Map<string, string>();
    const playoffMatchupsFinalized = new Map<string, Array<{ matchup_id: string; playoff_round: number; winner_id: string | null }>>();
    const bestDayCandidates = new Map<string, { value: number; teamId: string; date: string; season: string }>();

    interface MatchupResult {
      /** False when another run claimed this matchup first — apply nothing. */
      claimed: boolean;
      notification: {
        leagueId: string; homeTeamId: string; awayTeamId: string;
        homeScore: number; awayScore: number; winnerId: string | null;
        isPlayoff: boolean; playoffRound: number | null;
        homeCatWins?: number | null; awayCatWins?: number | null;
        catTies?: number | null; scoringType?: string;
      } | null;
      affectedTeamIds: Array<{ teamId: string; leagueId: string }>;
      playoffResult: { leagueId: string; matchup_id: string; playoff_round: number; winner_id: string | null } | null;
      bestDay: { leagueId: string; value: number; teamId: string; date: string; season: string } | null;
    }

    const settled = await Promise.allSettled(
      unfinalizedMatchups.map(async (matchup): Promise<MatchupResult> => {
        const empty: MatchupResult = { claimed: false, notification: null, affectedTeamIds: [], playoffResult: null, bestDay: null };
        const week = scheduleMap.get(matchup.schedule_id);
        if (!week || matchup.away_team_id === null) return empty;

        const isPlayoff = week.is_playoff || matchup.playoff_round != null;
        const weights = scoringByLeague.get(matchup.league_id) ?? [];
        const scoringType = scoringTypeByLeague.get(matchup.league_id) ?? 'points';
        const sport = sportByLeague.get(matchup.league_id) ?? 'nba';

        const homeData = teamDataMap.get(teamDataKey(matchup.home_team_id, week.start_date, week.end_date));
        const awayData = teamDataMap.get(teamDataKey(matchup.away_team_id, week.start_date, week.end_date));
        if (!homeData || !awayData) {
          log.warn('Missing prefetched team data for matchup', { matchup_id: matchup.id });
          return empty;
        }

        let winnerId: string | null = null;
        let homeScore = 0;
        let awayScore = 0;
        let homeCatWins: number | null = null;
        let awayCatWins: number | null = null;
        let catTies: number | null = null;
        let catResults: CategoryResult[] | null = null;
        let homePlayerScores: PlayerScoreEntry[] = [];
        let awayPlayerScores: PlayerScoreEntry[] = [];

        if (scoringType === 'h2h_categories') {
          const homeResult = computeTeamCategoryStats(homeData, sport);
          const awayResult = computeTeamCategoryStats(awayData, sport);
          homePlayerScores = homeResult.playerScores;
          awayPlayerScores = awayResult.playerScores;
          const comparison = compareCategoryStats(homeResult.teamStats, awayResult.teamStats, weights);
          homeCatWins = comparison.homeWins;
          awayCatWins = comparison.awayWins;
          catTies = comparison.ties;
          catResults = comparison.results;
          if (comparison.homeWins > comparison.awayWins) winnerId = matchup.home_team_id;
          else if (comparison.awayWins > comparison.homeWins) winnerId = matchup.away_team_id;
        } else {
          const homeResult = computeTeamScore(homeData, weights, sport);
          const awayResult = computeTeamScore(awayData, weights, sport);
          homeScore = homeResult.total;
          awayScore = awayResult.total;
          homePlayerScores = homeResult.playerScores;
          awayPlayerScores = awayResult.playerScores;
          if (homeScore > awayScore) winnerId = matchup.home_team_id;
          else if (awayScore > homeScore) winnerId = matchup.away_team_id;
        }

        // CLAIM + persist in ONE transaction, now that the score is known: the
        // matchup row, playoff bracket winner, week_scores, and the additive W/L
        // all commit together. If this run already lost the row to a concurrent
        // invocation, claimed=false and we apply nothing.
        const { data: claimRes, error: claimErr } = await supabase.rpc('finalize_matchup_atomic', {
          p_matchup_id: matchup.id,
          p_league_id: matchup.league_id,
          p_schedule_id: matchup.schedule_id,
          p_home_team_id: matchup.home_team_id,
          p_away_team_id: matchup.away_team_id,
          p_home_score: homeScore,
          p_away_score: awayScore,
          // gen-types marks RPC args non-nullable even when the SQL accepts NULL.
          // These genuinely are null in normal play: winner on a tie, and every
          // category field in a points league.
          p_winner_team_id: winnerId as unknown as string,
          p_home_category_wins: homeCatWins as unknown as number,
          p_away_category_wins: awayCatWins as unknown as number,
          p_category_ties: catTies as unknown as number,
          p_category_results: catResults as unknown as Json,
          p_home_player_scores: homePlayerScores as unknown as Json,
          p_away_player_scores: awayPlayerScores as unknown as Json,
          p_is_playoff: isPlayoff,
        });
        if (claimErr) throw claimErr;
        if (!(claimRes as unknown as { claimed?: boolean } | null)?.claimed) {
          log.info('Matchup already finalized by a concurrent run; skipping', { matchup_id: matchup.id });
          return empty;
        }

        let playoffResult: MatchupResult['playoffResult'] = null;
        if (isPlayoff && matchup.playoff_round != null) {
          playoffResult = { leagueId: matchup.league_id, matchup_id: matchup.id, playoff_round: matchup.playoff_round, winner_id: winnerId };
        }

        // Streaks are recomputed (absolutely) from these teams' matchups below.
        const affectedTeamIds: MatchupResult['affectedTeamIds'] = [];
        if (!isPlayoff) {
          affectedTeamIds.push(
            { teamId: matchup.home_team_id, leagueId: matchup.league_id },
            { teamId: matchup.away_team_id, leagueId: matchup.league_id },
          );
        }

        let bestDay: MatchupResult['bestDay'] = null;
        if (scoringType === 'points') {
          const season = week.start_date.slice(0, 4);
          for (const [tid, ps] of [[matchup.home_team_id, homePlayerScores], [matchup.away_team_id, awayPlayerScores]] as const) {
            const best = extractBestDay(ps as PlayerScoreEntry[]);
            if (best && (!bestDay || best.total > bestDay.value)) {
              bestDay = { leagueId: matchup.league_id, value: best.total, teamId: tid, date: best.date, season };
            }
          }
        }

        return {
          claimed: true,
          notification: {
            leagueId: matchup.league_id,
            homeTeamId: matchup.home_team_id,
            awayTeamId: matchup.away_team_id,
            homeScore, awayScore, winnerId,
            isPlayoff, playoffRound: matchup.playoff_round,
            homeCatWins, awayCatWins, catTies, scoringType,
          },
          affectedTeamIds,
          playoffResult,
          bestDay,
        };
      }),
    );

    // ── Merge results. Scores + W/L already committed inside the RPC; what remains
    // here is derived/absolute work (streaks, PF/PA) and notifications. ──
    const matchupResults: Array<NonNullable<MatchupResult['notification']>> = [];
    let finalizedCount = byeIds.length;

    for (const r of settled) {
      if (r.status === 'rejected') {
        // The RPC is all-or-nothing, so a rejected matchup claimed nothing and
        // stays is_finalized=false — the next run re-scores it.
        log.error('Failed to finalize a matchup', r.reason);
        continue;
      }
      const result = r.value;
      if (!result.claimed) continue;
      finalizedCount++;
      if (result.notification) matchupResults.push(result.notification);
      for (const { teamId, leagueId: lid } of result.affectedTeamIds) {
        affectedTeams.add(teamId);
        teamLeagueMap.set(teamId, lid);
      }
      if (result.playoffResult) {
        const { leagueId: lid, ...pr } = result.playoffResult;
        if (!playoffMatchupsFinalized.has(lid)) playoffMatchupsFinalized.set(lid, []);
        playoffMatchupsFinalized.get(lid)!.push(pr);
      }
      if (result.bestDay) {
        const prev = bestDayCandidates.get(result.bestDay.leagueId);
        if (!prev || result.bestDay.value > prev.value) {
          bestDayCandidates.set(result.bestDay.leagueId, result.bestDay);
        }
      }
    }

    if (affectedTeams.size > 0) {
      await Promise.all([...affectedTeams].map(async (teamId) => {
        const lid = teamLeagueMap.get(teamId)!;
        const streak = await computeStreak(teamId, lid);
        await supabase.from('teams').update({ streak }).eq('id', teamId);
      }));
    }

    // ── Refresh PF/PA from league_matchups (self-healing, mirrors update-standings step 2). ──
    if (leagueIds.length > 0) {
      await Promise.all(leagueIds.map(async (lid) => {
        const isCat = (scoringTypeByLeague.get(lid) ?? 'points') === 'h2h_categories';
        const { data: lm } = await supabase
          .from('league_matchups')
          .select('home_team_id, away_team_id, home_score, away_score, home_category_wins, away_category_wins')
          .eq('league_id', lid)
          .is('playoff_round', null);
        const pf: Record<string, number> = {};
        const pa: Record<string, number> = {};
        for (const m of lm ?? []) {
          const hs = isCat ? (Number(m.home_category_wins) || 0) : (Number(m.home_score) || 0);
          const as_ = isCat ? (Number(m.away_category_wins) || 0) : (Number(m.away_score) || 0);
          if (m.home_team_id) {
            pf[m.home_team_id] = (pf[m.home_team_id] ?? 0) + hs;
            pa[m.home_team_id] = (pa[m.home_team_id] ?? 0) + as_;
          }
          if (m.away_team_id) {
            pf[m.away_team_id] = (pf[m.away_team_id] ?? 0) + as_;
            pa[m.away_team_id] = (pa[m.away_team_id] ?? 0) + hs;
          }
        }
        const teamIds = [...new Set([...Object.keys(pf), ...Object.keys(pa)])];
        if (teamIds.length > 0) {
          await supabase.rpc('batch_update_team_standings', {
            p_updates: teamIds.map((tid) => ({
              id: tid,
              points_for: Math.round((pf[tid] ?? 0) * 100) / 100,
              points_against: Math.round((pa[tid] ?? 0) * 100) / 100,
            })),
          });
        }
      }));
    }

    // (stats_flushed is set inside finalize_matchup_atomic, in the same transaction
    // as the claim and the W/L increment — there is no longer a window between them.)

    // ── Upsert highest-scoring-day record per league, only on new high. ──
    if (bestDayCandidates.size > 0) {
      await Promise.all([...bestDayCandidates.entries()].map(async ([lid, candidate]) => {
        const { data: existing } = await supabase
          .from('league_records')
          .select('value')
          .eq('league_id', lid)
          .eq('record_type', 'highest_scoring_day')
          .single();
        if (!existing || candidate.value > Number(existing.value)) {
          await supabase.from('league_records').upsert({
            league_id: lid,
            record_type: 'highest_scoring_day',
            value: candidate.value,
            team_id: candidate.teamId,
            detail: candidate.date,
            season: candidate.season,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'league_id,record_type' });
        }
      }));
    }

    // ── Matchup result notifications (best-effort, non-fatal). ──
    try {
      const allTeamIds = new Set<string>();
      for (const r of matchupResults) {
        allTeamIds.add(r.homeTeamId);
        allTeamIds.add(r.awayTeamId);
      }
      const [{ data: teamRows }, { data: leagueRows }] = await Promise.all([
        supabase.from('teams').select('id, name').in('id', [...allTeamIds]),
        supabase.from('leagues').select('id, name, playoff_teams').in('id', leagueIds),
      ]);
      const teamName = new Map<string, string>((teamRows ?? []).map((t) => [t.id, t.name]));
      const leagueName = new Map<string, string>((leagueRows ?? []).map((l) => [l.id, l.name]));
      const leaguePlayoffTeams = new Map<string, number>((leagueRows ?? []).map((l) => [l.id, l.playoff_teams ?? 8]));

      function playoffRoundLabel(round: number, totalRounds: number): string {
        if (round >= totalRounds) return 'Championship';
        if (round === totalRounds - 1) return 'Semifinals';
        if (round === totalRounds - 2) return 'Quarterfinals';
        return `Playoff Round ${round}`;
      }

      await Promise.all(matchupResults.map(async (r) => {
        const homeName = teamName.get(r.homeTeamId) ?? 'Home';
        const awayName = teamName.get(r.awayTeamId) ?? 'Away';
        const category = r.isPlayoff ? 'playoffs' : 'matchups';
        const ln = leagueName.get(r.leagueId) ?? 'Your League';
        const homeWon = r.winnerId === r.homeTeamId;
        const awayWon = r.winnerId === r.awayTeamId;
        const tied = r.winnerId === null;

        if (r.isPlayoff && r.playoffRound != null) {
          const totalRounds = calcRounds(leaguePlayoffTeams.get(r.leagueId) ?? 8);
          const roundName = playoffRoundLabel(r.playoffRound, totalRounds);
          const isChampionship = r.playoffRound >= totalRounds;
          const isSemis = r.playoffRound === totalRounds - 1;

          const scoreLine = r.scoringType === 'h2h_categories'
            ? `${r.homeCatWins ?? 0}-${r.awayCatWins ?? 0}${(r.catTies ?? 0) > 0 ? `-${r.catTies}` : ''}`
            : `${r.homeScore} - ${r.awayScore}`;

          function buildPlayoffBody(won: boolean, opponentName: string, isTied: boolean): string {
            if (isTied) return `Tied ${scoreLine} vs ${opponentName}. What a battle.`;
            if (isChampionship) {
              return won
                ? `You beat ${opponentName} ${scoreLine} and won the championship! 🏆`
                : `${opponentName} wins ${scoreLine}. Tough loss in the finals.`;
            }
            if (won) {
              const next = isSemis ? 'On to the championship!' : 'You advance!';
              return `You beat ${opponentName} ${scoreLine}. ${next}`;
            }
            return `${opponentName} wins ${scoreLine}. Season over.`;
          }

          const homeBody = buildPlayoffBody(homeWon, awayName, tied);
          const awayBody = buildPlayoffBody(awayWon, homeName, tied);
          const icon = isChampionship ? '🏆' : '🏀';
          const title = `${icon} ${ln} — ${roundName}`;

          await Promise.all([
            notifyTeams(supabase, [r.homeTeamId], category, title, homeBody, { screen: 'playoff-bracket' }, undefined, { subtitle: roundName, priority: 'high' }),
            notifyTeams(supabase, [r.awayTeamId], category, title, awayBody, { screen: 'playoff-bracket' }, undefined, { subtitle: roundName, priority: 'high' }),
          ]);
        } else {
          const scoreLine = r.scoringType === 'h2h_categories'
            ? `${homeName} ${r.homeCatWins ?? 0}-${r.awayCatWins ?? 0}${(r.catTies ?? 0) > 0 ? `-${r.catTies}` : ''} ${awayName}`
            : `${homeName} ${r.homeScore} - ${r.awayScore} ${awayName}`;
          const homeResult = homeWon ? '🔥 You won!' : awayWon ? 'You lost.' : 'It\'s a tie.';
          const awayResult = awayWon ? '🔥 You won!' : homeWon ? 'You lost.' : 'It\'s a tie.';
          const title = `${ln} — Matchup Final`;

          await Promise.all([
            notifyTeams(supabase, [r.homeTeamId], category, title, `${scoreLine} — ${homeResult}`, { screen: 'matchup' }),
            notifyTeams(supabase, [r.awayTeamId], category, title, `${scoreLine} — ${awayResult}`, { screen: 'matchup' }),
          ]);
        }
      }));
    } catch (notifyErr) {
      log.warn('Matchup notification failed (non-fatal)', { error: String(notifyErr) });
    }

    // ── Post-processing: detect regular-season-complete → kick generate-playoff-round; advance playoff bracket. ──
    for (const lid of leagueIds) {
      const { data: league } = await supabase
        .from('leagues')
        .select('name, season, scoring_type, playoff_teams, playoff_seeding_format, reseed_each_round, regular_season_weeks')
        .eq('id', lid)
        .single();
      if (!league) continue;

      const { data: unfinalizedReg } = await supabase
        .from('league_matchups')
        .select('id')
        .eq('league_id', lid)
        .eq('is_finalized', false)
        .is('playoff_round', null)
        .limit(1);
      const allRegDone = !unfinalizedReg || unfinalizedReg.length === 0;

      if (allRegDone) {
        const { data: existingBracket } = await supabase
          .from('playoff_bracket')
          .select('id')
          .eq('league_id', lid)
          .eq('season', league.season)
          .limit(1);
        if (!existingBracket || existingBracket.length === 0) {
          const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SB_SECRET_KEY')}` },
            body: JSON.stringify({ league_id: lid, round: 1 }),
          });
        }
      }

      const playoffFinalized = playoffMatchupsFinalized.get(lid);
      if (playoffFinalized && playoffFinalized.length > 0) {
        const maxRound = Math.max(...playoffFinalized.map((p) => p.playoff_round));
        const { data: roundMatchups } = await supabase
          .from('league_matchups')
          .select('id, is_finalized')
          .eq('league_id', lid)
          .eq('playoff_round', maxRound);
        const allRoundDone = roundMatchups && roundMatchups.every((m) => m.is_finalized);

        if (allRoundDone) {
          const totalRounds = calcRounds(league.playoff_teams ?? 8);
          if (maxRound >= totalRounds) {
            // Championship just finished — notify league once.
            try {
              const { data: champBracket } = await supabase
                .from('playoff_bracket')
                .select('matchup_id')
                .eq('league_id', lid)
                .eq('season', league.season)
                .eq('round', maxRound)
                .eq('is_third_place', false)
                .not('matchup_id', 'is', null)
                .limit(1)
                .maybeSingle();
              const champMatchup = champBracket?.matchup_id
                ? playoffFinalized.find((p) => p.matchup_id === champBracket.matchup_id && p.winner_id)
                : playoffFinalized.find((p) => p.playoff_round === maxRound && p.winner_id);
              if (champMatchup?.winner_id) {
                const { data: champTeam } = await supabase.from('teams').select('name').eq('id', champMatchup.winner_id).single();
                const champName = champTeam?.name ?? 'The champion';
                const champLn = league?.name ?? 'Your League';
                await notifyLeague(supabase, lid, 'playoffs',
                  `🏆 ${champLn} — We Have a Champion!`,
                  `${champName} has won the league championship!`,
                  { screen: 'playoff-bracket' },
                  undefined, { subtitle: 'Championship', priority: 'high' });
              }
            } catch (champErr) {
              log.warn('Championship notification failed (non-fatal)', { error: String(champErr) });
            }
          } else {
            const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SB_SECRET_KEY')}` },
              body: JSON.stringify({ league_id: lid, round: maxRound + 1 }),
            });
          }
        }
      }
    }

    return jsonResponse({
      ok: true,
      finalized: finalizedCount,
      leagues: leagueIds.length,
      teamsUpdated: affectedTeams.size,
    });
  } catch (err) {
    return handleError(err, 'finalize-week');
  }
});
