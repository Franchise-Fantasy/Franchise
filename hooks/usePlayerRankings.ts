import { useMemo } from 'react';

import { usePlayerSeasonStats } from '@/hooks/usePlayerSeasonStats';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';


export interface PlayerRanking {
  overallRank: number;
  totalPlayers: number;
  positionRank: number;
  totalAtPosition: number;
  primaryPosition: string;
}

/** Pure function — compute rankings for every player by avg fpts. */
export function computeRankings(
  players: PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
): Map<string, PlayerRanking> {
  const map = new Map<string, PlayerRanking>();
  if (players.length === 0) return map;

  // Score every player
  const scored = players.map(p => ({
    id: p.player_id,
    position: p.position?.split('-')[0] ?? 'UTIL',
    fpts: calculateAvgFantasyPoints(p, scoringWeights),
  }));

  // Sort descending by fpts
  scored.sort((a, b) => b.fpts - a.fpts);

  // Assign overall rank (standard competition: 1, 2, 2, 4)
  const overallRank: number[] = [];
  for (let i = 0; i < scored.length; i++) {
    overallRank.push(
      i > 0 && scored[i].fpts === scored[i - 1].fpts ? overallRank[i - 1] : i + 1,
    );
  }

  // Group indices by position, already sorted by fpts
  const positionGroups = new Map<string, number[]>();
  for (let i = 0; i < scored.length; i++) {
    const pos = scored[i].position;
    let group = positionGroups.get(pos);
    if (!group) {
      group = [];
      positionGroups.set(pos, group);
    }
    group.push(i);
  }

  // Assign position rank and build result map
  for (const [pos, indices] of positionGroups) {
    const posRanks: number[] = [];
    for (let j = 0; j < indices.length; j++) {
      posRanks.push(
        j > 0 && scored[indices[j]].fpts === scored[indices[j - 1]].fpts
          ? posRanks[j - 1]
          : j + 1,
      );
    }

    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j];
      map.set(scored[idx].id, {
        overallRank: overallRank[idx],
        totalPlayers: scored.length,
        positionRank: posRanks[j],
        totalAtPosition: indices.length,
        primaryPosition: pos,
      });
    }
  }

  return map;
}

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
