import { PlayerGameLog, PlayerSeasonStats } from "@/types/player";

/** Per-game averages in the same `avg_*` shape as player_season_stats rows. */
export interface WindowAverages {
  games_played: number;
  avg_pts: number;
  avg_reb: number;
  avg_ast: number;
  avg_stl: number;
  avg_blk: number;
  avg_tov: number;
  avg_min: number;
  avg_fgm: number;
  avg_fga: number;
  avg_3pm: number;
  avg_3pa: number;
  avg_ftm: number;
  avg_fta: number;
}

/**
 * Returns a player's most recent `n` PLAYED games (min > 0) from a DESC-ordered
 * game log — the single source of truth for "last N games" across the roster
 * display, the windowed FPTS calc, and the auto-lineup ranking. Grabs 2× the
 * window before filtering DNPs so a stretch of healthy scratches doesn't shrink
 * the sample below `n`. Returns [] for an empty/missing log.
 */
export function lastNPlayedGames(
  log: PlayerGameLog[] | undefined,
  n: number,
): PlayerGameLog[] {
  if (!log || log.length === 0) return [];
  const slice = log.slice(0, Math.max(n, 1) * 2);
  return slice.filter((g) => (g.min ?? 0) > 0).slice(0, n);
}

/**
 * Builds a player_season_stats-shaped row from a windowed slice of game logs,
 * preserving the base row's identity fields (name, position, birthdate, etc.)
 * so it can flow into anything that expects a PlayerSeasonStats — notably the
 * category composite, which reads avg_* counting stats AND total_* makes/
 * attempts for the percentage cats. Totals are reconstructed as avg × games.
 * Returns null when the window has no played games (caller falls back).
 */
export function buildWindowedStatRow(
  base: PlayerSeasonStats,
  log: PlayerGameLog[] | undefined,
  windowSize: number,
): PlayerSeasonStats | null {
  const played = lastNPlayedGames(log, windowSize);
  if (played.length === 0) return null;
  const avg = averageGames(played);
  if (!avg) return null;
  const gp = avg.games_played;
  const tot = (perGame: number) => Math.round(perGame * gp);
  return {
    ...base,
    games_played: gp,
    avg_pts: avg.avg_pts,
    avg_reb: avg.avg_reb,
    avg_ast: avg.avg_ast,
    avg_stl: avg.avg_stl,
    avg_blk: avg.avg_blk,
    avg_tov: avg.avg_tov,
    avg_min: avg.avg_min,
    avg_fgm: avg.avg_fgm,
    avg_fga: avg.avg_fga,
    avg_3pm: avg.avg_3pm,
    avg_3pa: avg.avg_3pa,
    avg_ftm: avg.avg_ftm,
    avg_fta: avg.avg_fta,
    total_pts: tot(avg.avg_pts),
    total_reb: tot(avg.avg_reb),
    total_ast: tot(avg.avg_ast),
    total_stl: tot(avg.avg_stl),
    total_blk: tot(avg.avg_blk),
    total_tov: tot(avg.avg_tov),
    total_fgm: tot(avg.avg_fgm),
    total_fga: tot(avg.avg_fga),
    total_3pm: tot(avg.avg_3pm),
    total_3pa: tot(avg.avg_3pa),
    total_ftm: tot(avg.avg_ftm),
    total_fta: tot(avg.avg_fta),
  };
}

/**
 * Averages a window of games into per-game stats (DNPs — `min === 0` — excluded
 * so they don't drag the averages down). Returns null when no game was played.
 * Shooting percentages are reconstructed downstream from the averaged
 * makes/attempts, which equals the summed makes ÷ summed attempts.
 */
export function averageGames(games: PlayerGameLog[]): WindowAverages | null {
  const played = games.filter((g) => g.min > 0);
  const n = played.length;
  if (n === 0) return null;

  const mean = (sel: (g: PlayerGameLog) => number) =>
    played.reduce((acc, g) => acc + (sel(g) || 0), 0) / n;

  return {
    games_played: n,
    avg_pts: mean((g) => g.pts),
    avg_reb: mean((g) => g.reb),
    avg_ast: mean((g) => g.ast),
    avg_stl: mean((g) => g.stl),
    avg_blk: mean((g) => g.blk),
    avg_tov: mean((g) => g.tov),
    avg_min: mean((g) => g.min),
    avg_fgm: mean((g) => g.fgm),
    avg_fga: mean((g) => g.fga),
    avg_3pm: mean((g) => g["3pm"]),
    avg_3pa: mean((g) => g["3pa"]),
    avg_ftm: mean((g) => g.ftm),
    avg_fta: mean((g) => g.fta),
  };
}
