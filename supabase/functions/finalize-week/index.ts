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

import type { Database } from '../../../types/database.types.ts';
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { createLogger } from '../_shared/log.ts';
import { notifyTeams, notifyLeague } from '../_shared/push.ts';

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
    // ── Recovery: flush stats for matchups claimed but not yet flushed ──
    // If a prior run crashed between is_finalized=true and stats_flushed=true,
    // re-apply scores/W-L from the existing matchup row so the data stays
    // self-healing. PF/PA is owned by update-standings and is recomputed from
    // scratch below for any touched league, so we pass 0 here to avoid
    // double-counting.
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

    const scheduleIds = pendingWeeks.map((w) => w.id);
    const scheduleMap = new Map(pendingWeeks.map((w) => [w.id, w]));

    // Atomically claim unfinalized matchups via UPDATE ... RETURNING. If two
    // invocations race, only one wins each row.
    const { data: unfinalizedMatchups, error: matchErr } = await supabase
      .from('league_matchups')
      .update({ is_finalized: true })
      .in('schedule_id', scheduleIds)
      .eq('is_finalized', false)
      .select('id, league_id, schedule_id, week_number, home_team_id, away_team_id, playoff_round');
    if (matchErr) throw matchErr;
    if (!unfinalizedMatchups || unfinalizedMatchups.length === 0) {
      return jsonResponse({ ok: true, finalized: 0, message: 'All matchups already finalized' });
    }

    // ── Bulk-load per-league scoring config in parallel (1 round-trip per league). ──
    const leagueIds = [...new Set(unfinalizedMatchups.map((m) => m.league_id))];
    const scoringByLeague = new Map<string, ScoringWeight[]>();
    const scoringTypeByLeague = new Map<string, string>();
    await Promise.all(leagueIds.map(async (lid) => {
      const [{ data: scoring }, { data: leagueRow }] = await Promise.all([
        supabase.from('league_scoring_settings').select('stat_name, point_value, is_enabled, inverse').eq('league_id', lid),
        supabase.from('leagues').select('scoring_type').eq('id', lid).single(),
      ]);
      scoringByLeague.set(lid, (scoring ?? []) as ScoringWeight[]);
      scoringTypeByLeague.set(lid, leagueRow?.scoring_type ?? 'points');
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
      statUpdates: Array<{ p_team_id: string; p_wins: number; p_losses: number; p_ties: number; p_pf: number; p_pa: number }>;
      weekScores: Array<{ league_id: string; schedule_id: string; team_id: string; score: number; updated_at: string }>;
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
        const empty: MatchupResult = { statUpdates: [], weekScores: [], notification: null, affectedTeamIds: [], playoffResult: null, bestDay: null };
        const week = scheduleMap.get(matchup.schedule_id);
        if (!week || matchup.away_team_id === null) return empty;

        const isPlayoff = week.is_playoff || matchup.playoff_round != null;
        const weights = scoringByLeague.get(matchup.league_id) ?? [];
        const scoringType = scoringTypeByLeague.get(matchup.league_id) ?? 'points';

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
          const homeResult = computeTeamCategoryStats(homeData);
          const awayResult = computeTeamCategoryStats(awayData);
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
          const homeResult = computeTeamScore(homeData, weights);
          const awayResult = computeTeamScore(awayData, weights);
          homeScore = homeResult.total;
          awayScore = awayResult.total;
          homePlayerScores = homeResult.playerScores;
          awayPlayerScores = awayResult.playerScores;
          if (homeScore > awayScore) winnerId = matchup.home_team_id;
          else if (awayScore > homeScore) winnerId = matchup.away_team_id;
        }

        await supabase
          .from('league_matchups')
          .update({
            home_score: homeScore,
            away_score: awayScore,
            home_category_wins: homeCatWins,
            away_category_wins: awayCatWins,
            category_ties: catTies,
            category_results: catResults as unknown as Database['public']['Tables']['league_matchups']['Update']['category_results'],
            home_player_scores: homePlayerScores as unknown as Database['public']['Tables']['league_matchups']['Update']['home_player_scores'],
            away_player_scores: awayPlayerScores as unknown as Database['public']['Tables']['league_matchups']['Update']['away_player_scores'],
            winner_team_id: winnerId,
          })
          .eq('id', matchup.id);

        let playoffResult: MatchupResult['playoffResult'] = null;
        if (isPlayoff && matchup.playoff_round != null) {
          await supabase
            .from('playoff_bracket')
            .update({ winner_id: winnerId })
            .eq('matchup_id', matchup.id);
          playoffResult = { leagueId: matchup.league_id, matchup_id: matchup.id, playoff_round: matchup.playoff_round, winner_id: winnerId };
        }

        const nowIso = new Date().toISOString();
        const weekScores = [
          { league_id: matchup.league_id, schedule_id: matchup.schedule_id, team_id: matchup.home_team_id, score: homeScore, updated_at: nowIso },
          { league_id: matchup.league_id, schedule_id: matchup.schedule_id, team_id: matchup.away_team_id, score: awayScore, updated_at: nowIso },
        ];

        const statUpdates: MatchupResult['statUpdates'] = [];
        const affectedTeamIds: MatchupResult['affectedTeamIds'] = [];
        if (!isPlayoff) {
          if (winnerId === matchup.home_team_id) {
            statUpdates.push(
              { p_team_id: matchup.home_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
              { p_team_id: matchup.away_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
            );
          } else if (winnerId === matchup.away_team_id) {
            statUpdates.push(
              { p_team_id: matchup.away_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
              { p_team_id: matchup.home_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
            );
          } else {
            statUpdates.push(
              { p_team_id: matchup.home_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
              { p_team_id: matchup.away_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
            );
          }
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
          statUpdates,
          weekScores,
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

    // ── Merge results, then flush stat updates + week_scores in parallel ──
    const pendingStatUpdates: Array<{ p_team_id: string; p_wins: number; p_losses: number; p_ties: number; p_pf: number; p_pa: number }> = [];
    const pendingWeekScores: Array<{ league_id: string; schedule_id: string; team_id: string; score: number; updated_at: string }> = [];
    const matchupResults: Array<NonNullable<MatchupResult['notification']>> = [];
    let finalizedCount = 0;

    for (const r of settled) {
      if (r.status === 'rejected') {
        log.error('Failed to finalize a matchup', r.reason);
        continue;
      }
      const result = r.value;
      finalizedCount++;
      pendingStatUpdates.push(...result.statUpdates);
      pendingWeekScores.push(...result.weekScores);
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

    await Promise.all([
      ...pendingStatUpdates.map((params) => supabase.rpc('increment_team_stats', params)),
      pendingWeekScores.length > 0
        ? supabase.from('week_scores').upsert(pendingWeekScores, { onConflict: 'league_id,schedule_id,team_id' })
        : Promise.resolve(),
    ]);

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

    // Mark stats_flushed so a crash-recovery re-run skips W/L double counting.
    const matchupIds = unfinalizedMatchups.map((m) => m.id);
    if (matchupIds.length > 0) {
      await supabase.from('league_matchups').update({ stats_flushed: true }).in('id', matchupIds);
    }

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
