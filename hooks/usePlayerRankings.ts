import { useMemo } from 'react';

import { isSeasonStarted } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { usePlayerProjections } from '@/hooks/usePlayerProjections';
import { usePlayerSeasonStats } from '@/hooks/usePlayerSeasonStats';
import { ScoringWeight } from '@/types/player';
import { getSportToday } from '@/utils/leagueTime';
import { PlayerRanking, computeRankings } from '@/utils/scoring/playerRankings';

export type { PlayerRanking, RankingBasis } from '@/utils/scoring/playerRankings';
export { computeRankings } from '@/utils/scoring/playerRankings';

/**
 * Ranks the whole player pool once, keyed by player_id.
 *
 * The basis moves with the calendar. In-season it's actual FPTS/G off
 * `player_season_stats`. Pre-tipoff that matview is empty for every player (it's
 * scoped to `season_config.is_current`), so scoring it would tie the entire pool
 * at 0 and badge all of them "#1 OVR" — the same trap the roster stat window
 * already avoids. There the pool is ranked on the season-long projection, and a
 * sport with no projections engine (NFL) gets no ranking at all rather than a
 * pool of co-leaders.
 */
export function usePlayerRankingsMap(
  scoringWeights: ScoringWeight[] | undefined,
  leagueId?: string | null,
): Map<string, PlayerRanking> | null {
  const { data: allPlayers } = usePlayerSeasonStats();
  // The pool is already sport-scoped (usePlayerSeasonStats filters on the
  // active league's sport); the SCORING has to match it or an NFL pool ranks
  // all-zero and every player shows as #1.
  const sport = useActiveLeagueSport(leagueId);
  const isPreSeason = !isSeasonStarted(sport, getSportToday(sport));
  const { data: seasonProjections } = usePlayerProjections(
    sport,
    'season',
    isPreSeason && sport !== 'nfl',
  );

  return useMemo(() => {
    if (!allPlayers || !scoringWeights || scoringWeights.length === 0) return null;
    // While the projection query is still in flight the pool falls back to the
    // season basis, which pre-tipoff yields no ranking at all — that's the point:
    // no badge beats a wrong badge that later moves.
    return computeRankings(
      allPlayers,
      scoringWeights,
      sport,
      isPreSeason ? seasonProjections : null,
    );
  }, [allPlayers, scoringWeights, sport, isPreSeason, seasonProjections]);
}

export function usePlayerRankings(
  playerId: string | undefined,
  scoringWeights: ScoringWeight[] | undefined,
  leagueId?: string | null,
): PlayerRanking | null {
  const rankingsMap = usePlayerRankingsMap(scoringWeights, leagueId);
  if (!rankingsMap || !playerId) return null;
  return rankingsMap.get(playerId) ?? null;
}
