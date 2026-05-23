import { useMemo } from 'react';

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

  const rankingsMap = useMemo(() => {
    if (!allPlayers || !scoringWeights || scoringWeights.length === 0) return null;
    return computeRankings(allPlayers, scoringWeights);
  }, [allPlayers, scoringWeights]);

  if (!rankingsMap || !playerId) return null;
  return rankingsMap.get(playerId) ?? null;
}
