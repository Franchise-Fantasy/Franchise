import { useMemo } from 'react';

import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { usePlayerSeasonStats } from '@/hooks/usePlayerSeasonStats';
import { ScoringWeight } from '@/types/player';
import { PlayerRanking, computeRankings } from '@/utils/scoring/playerRankings';

export type { PlayerRanking } from '@/utils/scoring/playerRankings';
export { computeRankings } from '@/utils/scoring/playerRankings';

export function usePlayerRankings(
  playerId: string | undefined,
  position: string | undefined,
  scoringWeights: ScoringWeight[] | undefined,
): PlayerRanking | null {
  const { data: allPlayers } = usePlayerSeasonStats();
  // The pool is already sport-scoped (usePlayerSeasonStats filters on the
  // active league's sport); the SCORING has to match it or an NFL pool ranks
  // all-zero and every player shows as #1.
  const sport = useActiveLeagueSport();

  const rankingsMap = useMemo(() => {
    if (!allPlayers || !scoringWeights || scoringWeights.length === 0) return null;
    return computeRankings(allPlayers, scoringWeights, sport);
  }, [allPlayers, scoringWeights, sport]);

  if (!rankingsMap || !playerId) return null;
  return rankingsMap.get(playerId) ?? null;
}
