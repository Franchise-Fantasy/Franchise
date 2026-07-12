import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { lastNPlayedGames } from '@/utils/scoring/windowAverages';
import { getSportModule } from '@/utils/sports/registry';

// Stat-name → column maps live in utils/sports/registry.ts (single source
// shared with edge functions). These NBA re-exports keep existing basketball
// call sites working unchanged; the casts pin the registry's string columns
// back to the typed table rows for indexed access.
const NBA_MODULE = getSportModule('nba');

// Maps league_scoring_settings stat_name to player_season_stats total column
export const STAT_TO_TOTAL = NBA_MODULE.statToTotal as Record<string, keyof PlayerSeasonStats>;

// Maps league_scoring_settings stat_name to player_games column
export const STAT_TO_GAME = NBA_MODULE.statToGame as Record<string, keyof PlayerGameLog>;

// Maps league_scoring_settings stat_name to a player_projections proj_* column.
// Projections are already per-game means, so fpts is a direct weighted sum.
// DD/TD/PF are intentionally absent — the model doesn't project them, so they
// contribute 0 (same limitation as seasonAvgRowToFpts).
export const STAT_TO_PROJ: Record<string, string> = NBA_MODULE.statToProj;

// Sport-aware map lookups. Every calc function below takes an optional
// `sport` (default 'nba'), so basketball call sites are untouched while
// NFL leagues pass their sport through from useLeague/league.sport.
function statToTotalFor(sport?: string | null): Record<string, keyof PlayerSeasonStats> {
  return getSportModule(sport).statToTotal as Record<string, keyof PlayerSeasonStats>;
}
function statToGameFor(sport?: string | null): Record<string, keyof PlayerGameLog> {
  return getSportModule(sport).statToGame as Record<string, keyof PlayerGameLog>;
}

// Computes true average FPTS per game using season totals, then dividing by games played.
// This avoids rounding drift from averaging stats first then multiplying by weights.
export function calculateAvgFantasyPoints(
  player: PlayerSeasonStats,
  scoringWeights: ScoringWeight[],
  sport?: string | null,
): number {
  if (player.games_played === 0) return 0;

  const statToTotal = statToTotalFor(sport);
  let totalFantasy = 0;
  for (const weight of scoringWeights) {
    const field = statToTotal[weight.stat_name];
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
// Three row shapes rely on this:
//   • usePrevSeasonFpts / usePlayerHistoricalStats select the persisted dd/td
//     TOTALS directly — those are present, so they're skipped and only the
//     shooting splits get reconstructed.
//   • windowed rows from averageGames() carry avg_dd/avg_td RATES (0–1 per
//     game) but no totals — dd/td get reconstructed to counts like everything
//     else (round(rate × games)), so the recent-window FPTS scores DD/TD too.
//   • averages-only rows (e.g. the age-progression chart) that carry neither a
//     total nor an avg for dd/td can't score them — the absent total stays 0
//     (calculateAvgFantasyPoints treats absent as 0, not NaN).
const AVG_TO_TOTAL_RECONSTRUCT: [avgKey: string, totalKey: keyof PlayerSeasonStats][] = [
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
  // Windowed rows carry avg_dd/avg_td as per-game rates → round(rate × games)
  // yields the DD/TD count. Historical/season rows carry total_dd/total_td
  // directly (present → skipped here).
  ['avg_dd', 'total_dd'],
  ['avg_td', 'total_td'],
];

function reconstructTotals(row: Record<string, unknown>, sport?: string | null): PlayerSeasonStats {
  const games = Number(row.games_played) || 0;
  const out: Record<string, unknown> = { ...row };
  // Basketball keeps the hand-curated table (dd/td rate semantics). Other
  // sports derive the pairs from the registry: every total_<col> has an
  // avg_<col> twin in the matview, and yardage averages are fractional so
  // totals reconstruct with round() exactly like the basketball path.
  const pairs: Array<[string, string]> =
    getSportModule(sport).sport === 'nfl'
      ? Object.values(getSportModule(sport).statToTotal).map((totalKey) => [
          totalKey.replace(/^total_/, 'avg_'),
          totalKey,
        ])
      : AVG_TO_TOTAL_RECONSTRUCT;
  for (const [avgKey, totalKey] of pairs) {
    if (out[totalKey] != null) continue;
    const avg = Number(out[avgKey]);
    out[totalKey] = Number.isFinite(avg) ? Math.round(avg * games) : 0;
  }
  return out as unknown as PlayerSeasonStats;
}

// Turns a per-game-averages row into FPTS/G using the same totals-based formula
// as the rest of the app. Reconstructs whatever totals are missing (see
// AVG_TO_TOTAL_RECONSTRUCT) so a row carrying only avg_* columns — or one that
// already persists dd/td totals — both score consistently. Shared by
// usePrevSeasonFpts, usePlayerHistoricalStats (season chips), the recent-window
// lenses, and the age-progression chart so they never drift.
export function seasonAvgRowToFpts(
  row: Record<string, unknown>,
  scoringWeights: ScoringWeight[],
  sport?: string | null,
): number {
  return calculateAvgFantasyPoints(reconstructTotals(row, sport), scoringWeights, sport);
}

// Turns a player_projections row (per-game projected means) into projected
// FPTS/G using this league's scoring weights. The projections table stores the
// raw stat line (league-agnostic); fantasy value is derived per-league here,
// exactly like season stats. DD/TD/PF aren't projected and score as 0.
export function projAvgRowToFpts(
  proj: Record<string, unknown>,
  scoringWeights: ScoringWeight[],
  sport?: string | null,
): number {
  // NFL has no projections in v1 (statToProj is empty) — every weight skips
  // and the result is 0; callers already fall back when projections are absent.
  const statToProj = getSportModule(sport).statToProj;
  let total = 0;
  for (const weight of scoringWeights) {
    const field = statToProj[weight.stat_name];
    if (!field) continue;
    const v = Number(proj[field]);
    if (!Number.isFinite(v)) continue;
    total += v * weight.point_value;
  }
  return Math.round(total * 100) / 100;
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
  sport?: string | null,
): number {
  const currentFpts = calculateAvgFantasyPoints(player, scoringWeights, sport);
  if ((player.games_played ?? 0) >= minGames) return currentFpts;
  const fallback = prevSeasonFptsMap?.get(player.player_id);
  return fallback != null && fallback > 0 ? fallback : currentFpts;
}

// Computes fantasy points for a single game.
export function calculateGameFantasyPoints(
  game: PlayerGameLog,
  scoringWeights: ScoringWeight[],
  sport?: string | null,
): number {
  const statToGame = statToGameFor(sport);
  let total = 0;
  for (const weight of scoringWeights) {
    const field = statToGame[weight.stat_name];
    if (field) {
      const val = game[field];
      if (val == null) continue;
      total += (typeof val === 'boolean' ? (val ? 1 : 0) : (val as number)) * weight.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

/** Time-window for comparative analytics. "L5" = last 5 played games per
 *  player, etc. "season" uses player_season_stats season averages directly.
 *  Game-based (not day-based) because uneven schedules biased a day window:
 *  Team A with 8 games and Team B with 12 in the same 14 days wasn't an
 *  apples-to-apples FPTS/G comparison. Sliced per-player so each player
 *  contributes equal samples to the team avg. */
export type GameWindow = 'L5' | 'L10' | 'L15' | 'season';

export const GAME_WINDOW_VALUES: readonly GameWindow[] = ['L5', 'L10', 'L15', 'season'] as const;

/** Last-N count for a Lx window. Returns null for 'season'. */
export function gameWindowSize(w: GameWindow): number | null {
  if (w === 'season') return null;
  return parseInt(w.slice(1), 10);
}

/** Returns FPTS/G averaged over the player's last N played games (DNPs with
 *  min === 0 are skipped so a stretch of healthy scratches doesn't drag the
 *  average down). null when the log is empty or has no played games — caller
 *  decides whether to fall back to season / prev-season. */
export function windowFantasyPoints(
  log: PlayerGameLog[] | undefined,
  scoringWeights: ScoringWeight[],
  windowSize: number,
  sport?: string | null,
): number | null {
  const played = lastNPlayedGames(log, windowSize);
  if (played.length === 0) return null;
  let total = 0;
  for (const g of played) total += calculateGameFantasyPoints(g, scoringWeights, sport);
  return Math.round((total / played.length) * 10) / 10;
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
  scoringWeights: ScoringWeight[],
  sport?: string | null,
): { rows: FptsBreakdownRow[]; total: number } {
  const statToGame = statToGameFor(sport);
  const rows: FptsBreakdownRow[] = [];
  let total = 0;
  for (const weight of scoringWeights) {
    const field = statToGame[weight.stat_name];
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
