import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints, projAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

/** Which numbers a ranking was computed from. Pre-tipoff `player_season_stats`
 *  is empty for every player (the matview is scoped to `season_config.is_current`),
 *  so the pool is ranked on season-long projections instead of averages. */
export type RankingBasis = 'season' | 'projected';

export interface PlayerRanking {
  overallRank: number;
  totalPlayers: number;
  positionRank: number;
  totalAtPosition: number;
  primaryPosition: string;
  basis: RankingBasis;
}

/**
 * Pure function — compute rankings for every player by avg fpts.
 *
 * Pass `projections` (season-horizon rows keyed by player_id) to rank the pool
 * on projected FPTS/G instead of actual season averages; a player with no
 * projection row scores 0 and lands at the back.
 *
 * Returns an EMPTY map when nothing in the pool scores above zero. That's the
 * pre-tipoff state with no projections to fall back on — every player ties, and
 * badging all 585 of them "#1 OVR" reads as a result rather than the absence of
 * one.
 */
export function computeRankings(
  players: PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
  sport?: string | null,
  projections?: ReadonlyMap<string, Record<string, unknown>> | null,
): Map<string, PlayerRanking> {
  const map = new Map<string, PlayerRanking>();
  if (players.length === 0) return map;

  const basis: RankingBasis = projections ? 'projected' : 'season';

  // Score every player. Without `sport` an NFL pool scores all-zero (the NBA
  // stat map matches none of its weights) and every player ties at rank #1.
  const scored = players.map(p => {
    const proj = projections?.get(p.player_id);
    return {
      id: p.player_id,
      position: p.position?.split('-')[0] ?? 'UTIL',
      fpts: projections
        ? proj
          ? projAvgRowToFpts(proj, scoringWeights, sport)
          : 0
        : calculateAvgFantasyPoints(p, scoringWeights, sport),
    };
  });

  // Sort descending by fpts
  scored.sort((a, b) => b.fpts - a.fpts);

  // An unranked pool, not a pool of co-leaders — see the doc comment.
  if (scored[0].fpts <= 0) return map;

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
        basis,
      });
    }
  }

  return map;
}
