/**
 * Dependency Risk — what share of a team's production comes from its top few
 * players.
 *
 * Uses games-weighted total production (per-game × games_played) so that
 * a star who missed 20 games registers as less of a dependency
 * than one who played all season. Only the ACTIVE roster counts — an IR/taxi
 * stash isn't contributing, so it shouldn't dilute the denominator.
 *
 * Points leagues: total FPTS from league scoring weights.
 * Categories leagues: composite stat contribution (counting stats
 * + attempt volume − turnovers) × games played.
 * Both fall back to last season's per-game value on a thin current-season
 * sample, the same way every other analytics view does.
 *
 * Before tip-off nobody has a game logged, so the games weighting is dropped
 * for that window (see `computeDependencyRisk`) — otherwise every roster
 * multiplies out to zero and the whole card reads 0%.
 *
 * Risk labels are assigned *relative to the rest of the league* by rank on
 * the top-N share (`assignDependencyLevels`) — so the card always shows a
 * spread (most- to least-concentrated). Ranking by rank-fraction thirds (not
 * the raw min/max range) keeps a single outlier from collapsing everyone else.
 */

import type { LeaguePlayerWithTeam } from '@/hooks/useLeagueRosterStats';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { isActiveRosterSlot } from '@/utils/roster/rosterSlots';
import {
  ANALYTICS_MIN_CURRENT_SEASON_GAMES,
  effectiveFantasyPoints,
} from '@/utils/scoring/fantasyPoints';

export interface DependencyResult {
  teamId: string;
  /** 0–1, fraction of total production from the top N (shown on the bar) */
  topPct: number;
  /** Names of the top N producers */
  topPlayers: string[];
  /** Total roster size with meaningful production */
  totalContributors: number;
}

export type DependencyLevel = 'high' | 'moderate' | 'deep';

/**
 * Assign each team a risk level relative to the rest of its league, ranked by
 * top-N share. The producing teams are split into rank-fraction thirds: top
 * third → high, middle → moderate, bottom → deep. This always yields a spread
 * (there's a most- and least-concentrated team), and colors track the % shown
 * so equal %s always share a color.
 *
 * Teams with no production default to `deep` — there's nothing to concentrate —
 * and are excluded from the ranking. With fewer than three producing teams
 * there's no meaningful spread to draw, so everyone is `deep` rather than
 * fabricating risk from a two-team sample.
 */
export function assignDependencyLevels(
  results: DependencyResult[],
): Map<string, DependencyLevel> {
  const levels = new Map<string, DependencyLevel>();

  const producing = results
    .filter((r) => r.topPct > 0)
    .sort((a, b) => b.topPct - a.topPct);

  // Zero-production teams default to deep.
  for (const r of results) {
    if (r.topPct <= 0) levels.set(r.teamId, 'deep');
  }

  const n = producing.length;
  if (n < 3) {
    for (const r of producing) levels.set(r.teamId, 'deep');
    return levels;
  }

  producing.forEach((r, i) => {
    const frac = i / (n - 1); // 0 = most concentrated, 1 = least
    const level: DependencyLevel =
      frac < 1 / 3 ? 'high' : frac > 2 / 3 ? 'deep' : 'moderate';
    levels.set(r.teamId, level);
  });

  return levels;
}

/**
 * For categories leagues: a player's per-game "stat contribution"
 * (counting stats + attempt volume − turnovers).
 *
 * Reads per-game averages only, so it scores a `player_season_stats` row and a
 * `player_historical_stats` row identically — the latter is what the
 * prev-season fallback runs on, and it carries no `total_fga`/`total_fta`.
 */
export function catContributionPerGame(p: Partial<PlayerSeasonStats>): number {
  if (!p.games_played) return 0;

  const counting =
    (p.avg_pts ?? 0) +
    (p.avg_reb ?? 0) +
    (p.avg_ast ?? 0) +
    (p.avg_stl ?? 0) +
    (p.avg_blk ?? 0) +
    (p.avg_3pm ?? 0);

  const volume = (p.avg_fga ?? 0) + (p.avg_fta ?? 0);

  const turnovers = p.avg_tov ?? 0;

  return counting + volume - turnovers;
}

/** Categories twin of `effectiveFantasyPoints` — same thin-sample fallback. */
function effectiveCatContribution(
  p: PlayerSeasonStats,
  prevSeasonMap: Map<string, number> | undefined,
  minGames: number,
): number {
  const current = catContributionPerGame(p);
  if ((p.games_played ?? 0) >= minGames) return current;
  const fallback = prevSeasonMap?.get(p.player_id);
  return fallback != null && fallback > 0 ? fallback : current;
}

/**
 * Highest current-season `games_played` across the supplied players. Zero means
 * the season hasn't tipped off yet, which changes how production is weighted.
 */
export function leagueMaxGamesPlayed(players: { games_played: number }[]): number {
  let max = 0;
  for (const p of players) {
    const g = p.games_played ?? 0;
    if (g > max) max = g;
  }
  return max;
}

/** Fallback when the league's roster config hasn't loaded (or has no starters). */
export const DEFAULT_DEPENDENCY_TOP_N = 3;

/**
 * How many players the bar covers: a quarter of the league's ACTIVE roster
 * (starters + bench, no IR/taxi), floor 3, ceiling 8. A hardcoded 3 was
 * near-meaningless on a 22-man dynasty roster — every team landed in a narrow
 * ~18-28% band. Scaling to roster depth keeps "a genuine core few" meaning the
 * same thing in a 12-man redraft league and a 22-man dynasty one.
 *
 * Deliberately league-wide, not per-team: comparing shares across teams is only
 * valid when every bar covers the same N.
 */
export function dependencyTopN(activeSlots: number | undefined): number {
  if (!activeSlots) return DEFAULT_DEPENDENCY_TOP_N;
  return Math.min(8, Math.max(3, Math.round(activeSlots / 4)));
}

export interface DependencyOptions {
  scoringType?: string;
  sport?: string | null;
  /** Prev-season per-game production in the league's currency (fpts for points
   *  leagues, cat contribution for categories) — the thin-sample fallback. */
  prevSeasonMap?: Map<string, number>;
  /** Players per bar. See `dependencyTopN`. */
  topN?: number;
}

export function computeDependencyRisk(
  players: LeaguePlayerWithTeam[],
  scoringWeights: ScoringWeight[],
  { scoringType, sport, prevSeasonMap, topN = DEFAULT_DEPENDENCY_TOP_N }: DependencyOptions = {},
): DependencyResult[] {
  const isCategories = scoringType === 'h2h_categories';
  // Nobody has a game logged before tip-off, so `perGame × games_played` is 0
  // for every player and the card shows a wall of 0%. In that window rank on
  // per-game production alone (the prev-season fallback supplies the value).
  const preseason = leagueMaxGamesPlayed(players) === 0;

  const byTeam = new Map<string, LeaguePlayerWithTeam[]>();
  for (const p of players) {
    // IR / taxi stashes aren't contributing, so they'd only dilute the share.
    if (!p.team_id || !isActiveRosterSlot(p.roster_slot)) continue;
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id)!.push(p);
  }

  const results: DependencyResult[] = [];

  for (const [teamId, roster] of byTeam) {
    const scored = roster
      .map(p => {
        const perGame = isCategories
          ? effectiveCatContribution(p, prevSeasonMap, ANALYTICS_MIN_CURRENT_SEASON_GAMES)
          : effectiveFantasyPoints(
              p,
              scoringWeights,
              prevSeasonMap,
              ANALYTICS_MIN_CURRENT_SEASON_GAMES,
              sport,
            );
        // Weight by games played for season-total contribution
        return { name: p.name, value: perGame * (preseason ? 1 : p.games_played || 0) };
      })
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);

    if (scored.length === 0) {
      results.push({ teamId, topPct: 0, topPlayers: [], totalContributors: 0 });
      continue;
    }

    const total = scored.reduce((sum, p) => sum + p.value, 0);
    const top = scored.slice(0, topN);
    const topTotal = top.reduce((sum, p) => sum + p.value, 0);

    results.push({
      teamId,
      topPct: total > 0 ? topTotal / total : 0,
      topPlayers: top.map(p => p.name),
      totalContributors: scored.length,
    });
  }

  return results;
}
