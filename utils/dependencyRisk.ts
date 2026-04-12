/**
 * Dependency Risk — what % of a team's total fantasy production
 * comes from their top 3 players.
 *
 * Uses games-weighted total FPTS (avg × games_played) so that
 * a star who missed 20 games registers as less of a dependency
 * than one who played all season.
 *
 * Points leagues: total FPTS from league scoring weights.
 * Categories leagues: composite stat contribution (counting stats
 * + attempt volume − turnovers) × games played.
 *
 * Thresholds are adaptive: computed relative to the league's actual
 * distribution rather than hardcoded percentages.
 */

import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import type { LeaguePlayerWithTeam } from '@/hooks/useLeagueRosterStats';

export interface DependencyResult {
  teamId: string;
  /** 0–1, fraction of total production from top 3 */
  topThreePct: number;
  /** Names of the top 3 producers */
  topThreePlayers: string[];
  /** Total roster size with meaningful production */
  totalContributors: number;
}

export interface DependencyThresholds {
  /** Above this = high risk (top third of league) */
  high: number;
  /** Above this = moderate risk (middle third) */
  moderate: number;
  /** League average dependency % */
  leagueAvg: number;
}

/**
 * For categories leagues: a player's per-game "stat contribution"
 * (counting stats + attempt volume − turnovers).
 */
function catContributionPerGame(p: PlayerSeasonStats): number {
  if (p.games_played === 0) return 0;

  const gp = p.games_played;
  const counting =
    (p.avg_pts ?? 0) +
    (p.avg_reb ?? 0) +
    (p.avg_ast ?? 0) +
    (p.avg_stl ?? 0) +
    (p.avg_blk ?? 0) +
    (p.avg_3pm ?? 0);

  const volume =
    ((p.total_fga ?? 0) / gp) +
    ((p.total_fta ?? 0) / gp);

  const turnovers = p.avg_tov ?? 0;

  return counting + volume - turnovers;
}

export function computeDependencyRisk(
  players: LeaguePlayerWithTeam[],
  scoringWeights: ScoringWeight[],
  scoringType?: string,
): DependencyResult[] {
  const isCategories = scoringType === 'h2h_categories';

  const byTeam = new Map<string, LeaguePlayerWithTeam[]>();
  for (const p of players) {
    if (!p.team_id) continue;
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id)!.push(p);
  }

  const results: DependencyResult[] = [];

  for (const [teamId, roster] of byTeam) {
    const scored = roster
      .map(p => {
        const perGame = isCategories
          ? catContributionPerGame(p)
          : calculateAvgFantasyPoints(p, scoringWeights);
        // Weight by games played for season-total contribution
        return { name: p.name, value: perGame * (p.games_played || 0) };
      })
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);

    if (scored.length === 0) {
      results.push({ teamId, topThreePct: 0, topThreePlayers: [], totalContributors: 0 });
      continue;
    }

    const total = scored.reduce((sum, p) => sum + p.value, 0);
    const topThree = scored.slice(0, 3);
    const topThreeTotal = topThree.reduce((sum, p) => sum + p.value, 0);

    results.push({
      teamId,
      topThreePct: total > 0 ? topThreeTotal / total : 0,
      topThreePlayers: topThree.map(p => p.name),
      totalContributors: scored.length,
    });
  }

  return results;
}

/**
 * Compute adaptive thresholds based on the league's actual distribution.
 * Splits the range into thirds: bottom = deep, middle = moderate, top = fragile.
 */
export function computeDependencyThresholds(results: DependencyResult[]): DependencyThresholds {
  if (results.length === 0) return { high: 0.65, moderate: 0.55, leagueAvg: 0 };

  const pcts = results.map(r => r.topThreePct).sort((a, b) => a - b);
  const min = pcts[0];
  const max = pcts[pcts.length - 1];
  const range = max - min;
  const leagueAvg = pcts.reduce((a, b) => a + b, 0) / pcts.length;

  return {
    high: min + range * 0.67,
    moderate: min + range * 0.33,
    leagueAvg,
  };
}
