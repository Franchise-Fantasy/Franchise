import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { NFL_GAME_COLUMNS } from "@/utils/scoring/nflStatLine";

// player_season_stats carries ~93 columns spanning every sport's stat set.
// Selecting only the active sport's columns (plus identity/meta) roughly
// halves the payload of the biggest fetch on the player-browser screens.
// Keep in sync with the coalesce map below and the per-sport stat names
// calculateAvgFantasyPoints reads.
const IDENTITY_COLS =
  "player_id, sport, name, position, pro_team, status, games_played, rookie, draft_year, birthdate, external_id_nba, season_added";
const BBALL_STATS = [
  "pts", "reb", "ast", "stl", "blk", "tov",
  "fgm", "fga", "3pm", "3pa", "ftm", "fta", "pf",
];
// NFL_GAME_COLUMNS is the per-game ingest set; the matview also aggregates
// these three, which NFL scoring settings can weight.
const NFL_STATS = [...NFL_GAME_COLUMNS, "two_pt", "xp_att", "dst_safety"];

export function seasonPoolColumns(sport: string): string {
  const stats = sport === "nfl" ? NFL_STATS : BBALL_STATS;
  const cols = stats.flatMap((s) => [`avg_${s}`, `total_${s}`]);
  if (sport !== "nfl") cols.push("avg_min", "total_dd", "total_td");
  return `${IDENTITY_COLS}, ${cols.join(", ")}`;
}

/**
 * The full browsable player pool for a sport, ordered by season scoring.
 * `pro_team IS NOT NULL` = currently on a real team's roster, which is the
 * correct "available in fantasy" filter year-round. Filtering on
 * `games_played > 0` instead would hide every player during the offseason
 * (WNBA April–May, NBA June–September).
 */
export async function fetchSeasonPool(sport: string): Promise<PlayerSeasonStats[]> {
  const { data, error } = await supabase
    .from("player_season_stats")
    .select(seasonPoolColumns(sport))
    .eq("sport", sport)
    .not("pro_team", "is", null)
    .order("avg_pts", { ascending: false })
    // PostgREST caps responses at max-rows (1000) anyway; make the cap
    // explicit so the pool size is a documented choice, not a surprise.
    .limit(1000);
  if (error) throw error;
  // The DB row types every numeric stat as `number | null` (a player with no
  // games played yet has NULL averages). PlayerSeasonStats claims they are
  // `number`, so downstream call sites like `player.avg_pts.toFixed(1)` crash
  // when the row is fresh / unscored — typically in test leagues. Coalesce so
  // the type matches reality (NFL rows get 0s for the basketball columns,
  // same as the nulls they used to carry).
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    games_played: r.games_played ?? 0,
    avg_min: r.avg_min ?? 0,
    avg_pts: r.avg_pts ?? 0,
    avg_reb: r.avg_reb ?? 0,
    avg_ast: r.avg_ast ?? 0,
    avg_stl: r.avg_stl ?? 0,
    avg_blk: r.avg_blk ?? 0,
    avg_tov: r.avg_tov ?? 0,
    avg_fgm: r.avg_fgm ?? 0,
    avg_fga: r.avg_fga ?? 0,
    avg_3pm: r.avg_3pm ?? 0,
    avg_3pa: r.avg_3pa ?? 0,
    avg_ftm: r.avg_ftm ?? 0,
    avg_fta: r.avg_fta ?? 0,
    avg_pf: r.avg_pf ?? 0,
    total_pts: r.total_pts ?? 0,
    total_reb: r.total_reb ?? 0,
    total_ast: r.total_ast ?? 0,
    total_stl: r.total_stl ?? 0,
    total_blk: r.total_blk ?? 0,
    total_tov: r.total_tov ?? 0,
    total_fgm: r.total_fgm ?? 0,
    total_fga: r.total_fga ?? 0,
    total_3pm: r.total_3pm ?? 0,
    total_3pa: r.total_3pa ?? 0,
    total_ftm: r.total_ftm ?? 0,
    total_fta: r.total_fta ?? 0,
    total_pf: r.total_pf ?? 0,
    total_dd: r.total_dd ?? 0,
    total_td: r.total_td ?? 0,
  })) as PlayerSeasonStats[];
}
