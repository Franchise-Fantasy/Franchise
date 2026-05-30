import { PlayerGameLog } from "@/types/player";

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
