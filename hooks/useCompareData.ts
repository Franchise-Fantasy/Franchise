import { useMemo } from 'react';

import type { CompareCandidate } from '@/context/CompareSelectionProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueScoringType } from '@/hooks/useLeagueScoringType';
import { usePlayerProjections } from '@/hooks/usePlayerProjections';
import { usePlayerSeasonStats } from '@/hooks/usePlayerSeasonStats';
import { useRosterGameLogs } from '@/hooks/useRosterGameLogs';
import type { PlayerSeasonStats } from '@/types/player';
import {
  buildCompareGroups,
  nineCatWinTally,
  type CompareGroup,
  type ResolvedComparePlayer,
} from '@/utils/scoring/compareStats';
import {
  calculateAvgFantasyPoints,
  projAvgRowToFpts,
  windowFantasyPoints,
} from '@/utils/scoring/fantasyPoints';
import { NFL_GAME_COLUMNS } from '@/utils/scoring/nflStatLine';
import { computeRankings } from '@/utils/scoring/playerRankings';
import { averageGames, lastNPlayedGames } from '@/utils/scoring/windowAverages';

interface UseCompareDataResult {
  groups: CompareGroup[];
  isCategories: boolean;
  /** Per-column 9-cat win count (category leagues only; null otherwise). */
  winTally: number[] | null;
  isLoading: boolean;
}

const pctOrNull = (makes: number, attempts: number): number | null =>
  attempts > 0 ? Math.round((makes / attempts) * 1000) / 10 : null;

/**
 * Composes the comparison matrix for a set of selected players. All data hooks
 * are keyed by `player_id`, so the candidates can come from any screen (free
 * agents, roster, trades). The heavy lifting (highlight + row sets) lives in
 * the pure `compareStats` util; this hook only resolves the per-player numbers.
 */
export function useCompareData(
  candidates: CompareCandidate[],
  leagueId: string,
): UseCompareDataResult {
  const sport = useActiveLeagueSport(leagueId);
  const { data: scoringWeights, isLoading: scoringLoading } = useLeagueScoring(leagueId);
  const { isCategories } = useLeagueScoringType(leagueId);

  const ids = useMemo(() => candidates.map((c) => c.player_id), [candidates]);

  const { data: allPlayers, isLoading: statsLoading } = usePlayerSeasonStats();
  const { data: gameLogs, isLoading: logsLoading } = useRosterGameLogs(ids);
  // Projected fantasy points only matter for points leagues.
  const projEnabled = !isCategories;
  const { data: nextProj, isLoading: nextProjLoading } = usePlayerProjections(
    sport,
    'next_game',
    projEnabled,
  );
  const { data: seasonProj } = usePlayerProjections(sport, 'season', projEnabled);

  const seasonStatsMap = useMemo(() => {
    const map = new Map<string, PlayerSeasonStats>();
    for (const p of allPlayers ?? []) map.set(p.player_id, p);
    return map;
  }, [allPlayers]);

  const rankingsMap = useMemo(() => {
    if (!allPlayers || !scoringWeights || scoringWeights.length === 0) return null;
    return computeRankings(allPlayers, scoringWeights, sport);
  }, [allPlayers, scoringWeights, sport]);

  const resolved = useMemo<ResolvedComparePlayer[]>(() => {
    return candidates.map((cand) => {
      // Prefer the snapshot's own stats (roster/trade rows carry them); fall
      // back to the shared top-600 pool; else identity-only (em-dash cells).
      const stats = cand.seasonStats ?? seasonStatsMap.get(cand.player_id) ?? null;
      const weights = scoringWeights ?? [];
      const log = gameLogs?.get(cand.player_id);
      const l10 = averageGames(lastNPlayedGames(log, 10));

      const nextRow = nextProj?.get(cand.player_id);
      const seasonRow = seasonProj?.get(cand.player_id);

      return {
        player_id: cand.player_id,
        gamesPlayed: stats?.games_played ?? 0,
        ranking: rankingsMap?.get(cand.player_id) ?? null,
        // Every fpts call needs `sport` — the NBA stat map matches none of an
        // NFL league's weights, so without it every NFL cell reads 0.0.
        seasonFpts: stats && weights.length ? calculateAvgFantasyPoints(stats, weights, sport) : null,
        nextGameProjFpts:
          nextRow && weights.length
            ? projAvgRowToFpts(nextRow as Record<string, unknown>, weights, sport)
            : null,
        seasonProjFpts:
          seasonRow && weights.length
            ? projAvgRowToFpts(seasonRow as Record<string, unknown>, weights, sport)
            : null,
        avgMin: stats?.avg_min ?? null,
        avgPts: stats?.avg_pts ?? null,
        avgReb: stats?.avg_reb ?? null,
        avgAst: stats?.avg_ast ?? null,
        avgStl: stats?.avg_stl ?? null,
        avgBlk: stats?.avg_blk ?? null,
        avgTov: stats?.avg_tov ?? null,
        fgPct: stats ? pctOrNull(stats.avg_fgm, stats.avg_fga) : null,
        ftPct: stats ? pctOrNull(stats.avg_ftm, stats.avg_fta) : null,
        tpPct: stats ? pctOrNull(stats.avg_3pm, stats.avg_3pa) : null,
        tpm: stats?.avg_3pm ?? null,
        l5Fpts: weights.length ? windowFantasyPoints(log, weights, 5, sport) : null,
        l10Fpts: weights.length ? windowFantasyPoints(log, weights, 10, sport) : null,
        l15Fpts: weights.length ? windowFantasyPoints(log, weights, 15, sport) : null,
        l10Pts: l10?.avg_pts ?? null,
        l10Reb: l10?.avg_reb ?? null,
        l10Ast: l10?.avg_ast ?? null,
        l10Stl: l10?.avg_stl ?? null,
        l10Blk: l10?.avg_blk ?? null,
        // NFL per-game averages, straight off the matview row's avg_* columns —
        // the basketball fields above are all NULL for an NFL player.
        nfl:
          sport === 'nfl' && stats
            ? Object.fromEntries(
                NFL_GAME_COLUMNS.map((c) => {
                  const v = (stats as unknown as Record<string, unknown>)[`avg_${c}`];
                  return [c, v == null ? null : Number(v)];
                }),
              )
            : undefined,
      };
    });
  }, [candidates, seasonStatsMap, scoringWeights, gameLogs, nextProj, seasonProj, rankingsMap, sport]);

  const groups = useMemo(
    () => buildCompareGroups(resolved, { isCategories, sport }),
    [resolved, isCategories, sport],
  );

  const winTally = useMemo(
    () => (isCategories ? nineCatWinTally(groups, resolved.length) : null),
    [isCategories, groups, resolved.length],
  );

  return {
    groups,
    isCategories,
    winTally,
    isLoading:
      statsLoading || logsLoading || scoringLoading || (projEnabled && nextProjLoading),
  };
}
