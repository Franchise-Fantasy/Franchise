import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from '@/types/player';

// Maps league_scoring_settings stat_name to player_season_stats total column
export const STAT_TO_TOTAL: Record<string, keyof PlayerSeasonStats> = {
  PTS: 'total_pts',
  REB: 'total_reb',
  AST: 'total_ast',
  STL: 'total_stl',
  BLK: 'total_blk',
  TO: 'total_tov',
  '3PM': 'total_3pm',
  '3PA': 'total_3pa',
  FGM: 'total_fgm',
  FGA: 'total_fga',
  FTM: 'total_ftm',
  FTA: 'total_fta',
  PF: 'total_pf',
  DD: 'total_dd',
  TD: 'total_td',
};

// Maps league_scoring_settings stat_name to player_games column
export const STAT_TO_GAME: Record<string, keyof PlayerGameLog> = {
  PTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  TO: 'tov',
  '3PM': '3pm',
  '3PA': '3pa',
  FGM: 'fgm',
  FGA: 'fga',
  FTM: 'ftm',
  FTA: 'fta',
  PF: 'pf',
  DD: 'double_double',
  TD: 'triple_double',
};

// Computes true average FPTS per game using season totals, then dividing by games played.
// This avoids rounding drift from averaging stats first then multiplying by weights.
export function calculateAvgFantasyPoints(
  player: PlayerSeasonStats,
  scoringWeights: ScoringWeight[]
): number {
  if (player.games_played === 0) return 0;

  let totalFantasy = 0;
  for (const weight of scoringWeights) {
    const field = STAT_TO_TOTAL[weight.stat_name];
    if (field) {
      // A stat absent from this row contributes 0, not NaN. Matters for
      // historical rows (via seasonAvgRowToFpts) that lack dd/td totals;
      // a no-op for player_season_stats rows where every total is present.
      totalFantasy += ((player[field] as number) || 0) * weight.point_value;
    }
  }
  return Math.round((totalFantasy / player.games_played) * 100) / 100;
}

// Rebuilds the `total_*` columns `calculateAvgFantasyPoints` reads from a row
// that only carries per-game averages (total = avg × games_played), but only
// for totals that are actually missing (`!= null` rows are left untouched).
// Two callers with different row shapes rely on this:
//   • usePrevSeasonFpts selects `*` — the DB persists totals for the
//     triple-double-signal stats (pts/reb/ast/stl/blk/tov + dd/td), so those
//     are skipped and only the shooting splits get reconstructed.
//   • the analytics progression selects averages only — every counting-stat
//     total is missing, so all of these get reconstructed.
// dd/td have no avg column anywhere, so an averages-only row can't score them
// (calculateAvgFantasyPoints treats the absent total as 0, not NaN).
const AVG_TO_TOTAL_RECONSTRUCT: Array<[avgKey: string, totalKey: keyof PlayerSeasonStats]> = [
  ['avg_pts', 'total_pts'],
  ['avg_reb', 'total_reb'],
  ['avg_ast', 'total_ast'],
  ['avg_stl', 'total_stl'],
  ['avg_blk', 'total_blk'],
  ['avg_tov', 'total_tov'],
  ['avg_fgm', 'total_fgm'],
  ['avg_fga', 'total_fga'],
  ['avg_3pm', 'total_3pm'],
  ['avg_3pa', 'total_3pa'],
  ['avg_ftm', 'total_ftm'],
  ['avg_fta', 'total_fta'],
  ['avg_pf', 'total_pf'],
];

function reconstructTotals(row: Record<string, unknown>): PlayerSeasonStats {
  const games = Number(row.games_played) || 0;
  const out: Record<string, unknown> = { ...row };
  for (const [avgKey, totalKey] of AVG_TO_TOTAL_RECONSTRUCT) {
    if (out[totalKey] != null) continue;
    const avg = Number(out[avgKey]);
    out[totalKey] = Number.isFinite(avg) ? Math.round(avg * games) : 0;
  }
  return out as unknown as PlayerSeasonStats;
}

// Turns a `player_historical_stats` row (per-game AVERAGES only — no totals,
// no dd/td) into FPTS/G using the same totals-based formula as the rest of
// the app. Shared by usePrevSeasonFpts (prev-season fallback weight) and the
// analytics season-progression chart so the two never drift.
export function seasonAvgRowToFpts(
  row: Record<string, unknown>,
  scoringWeights: ScoringWeight[],
): number {
  return calculateAvgFantasyPoints(reconstructTotals(row), scoringWeights);
}

// Threshold below which we treat the current-season sample as too small
// to be predictive — ~25% of a WNBA season, ~12% of an NBA season. Until
// the player crosses this, callers should prefer the previous-season fpts
// as a more stable signal (mirrors the auto-lineup fallback in roster.tsx).
// Auto-lineup uses this default; lineup decisions reward a stable sample.
export const MIN_CURRENT_SEASON_GAMES = 10;

// The analytics screens switch to current-season stats sooner — a roster
// strength / age read should feel current within a couple of weeks rather
// than showing last year's numbers deep into the new season. Still enough
// games to shrug off a single hot/cold night.
export const ANALYTICS_MIN_CURRENT_SEASON_GAMES = 5;

/** Returns a player's effective fpts-per-game for ranking / weighting:
 *  current-season avg once they've played `minGames` games this season,
 *  otherwise the supplied prev-season fpts (if any), otherwise the
 *  current value (which may be 0 during preseason). */
export function effectiveFantasyPoints(
  player: PlayerSeasonStats,
  scoringWeights: ScoringWeight[],
  prevSeasonFptsMap?: Map<string, number>,
  minGames: number = MIN_CURRENT_SEASON_GAMES,
): number {
  const currentFpts = calculateAvgFantasyPoints(player, scoringWeights);
  if ((player.games_played ?? 0) >= minGames) return currentFpts;
  const fallback = prevSeasonFptsMap?.get(player.player_id);
  return fallback != null && fallback > 0 ? fallback : currentFpts;
}

// Computes fantasy points for a single game.
export function calculateGameFantasyPoints(
  game: PlayerGameLog,
  scoringWeights: ScoringWeight[]
): number {
  let total = 0;
  for (const weight of scoringWeights) {
    const field = STAT_TO_GAME[weight.stat_name];
    if (field) {
      const val = game[field];
      if (val == null) continue;
      total += (typeof val === 'boolean' ? (val ? 1 : 0) : (val as number)) * weight.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

// Returns per-stat breakdown of fantasy points for a single game.
export interface FptsBreakdownRow {
  stat_name: string;
  stat_value: number;
  point_value: number;
  points: number;
}

export function getFantasyPointsBreakdown(
  game: PlayerGameLog | Record<string, number | boolean>,
  scoringWeights: ScoringWeight[]
): { rows: FptsBreakdownRow[]; total: number } {
  const rows: FptsBreakdownRow[] = [];
  let total = 0;
  for (const weight of scoringWeights) {
    const field = STAT_TO_GAME[weight.stat_name];
    if (!field) continue;
    const raw = (game as any)[field];
    if (raw == null) continue;
    const stat_value = typeof raw === 'boolean' ? (raw ? 1 : 0) : (raw as number);
    const points = Math.round(stat_value * weight.point_value * 100) / 100;
    total += points;
    rows.push({ stat_name: weight.stat_name, stat_value, point_value: weight.point_value, points });
  }
  return { rows, total: Math.round(total * 100) / 100 };
}

// Format a score: show hundredths only when non-zero (e.g. 42.5 not 42.50, but 42.75 stays)
export function formatScore(n: number): string {
  return n % 1 !== 0 && Math.round(n * 100) % 10 !== 0 ? n.toFixed(2) : n.toFixed(1);
}
