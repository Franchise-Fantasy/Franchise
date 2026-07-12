/**
 * NFL stat mapping shared by poll-live-stats and backfill-nfl-2025.
 *
 * Maps BDL NFL API fields (verified against live responses 2026-07-10 — see
 * wiki "NFL Support") onto the sparse NFL columns added to player_games /
 * live_player_stats by migration 20260710000004.
 *
 * Conventions:
 *   - Every NFL stat row is written with `min: 1` — the "played" sentinel the
 *     player_season_stats matview counts games by (FILTER WHERE min > 0).
 *     BDL only returns /stats rows for players who appeared, so a row = played.
 *   - `dst_pa_pts` is the DERIVED points-allowed tier result, computed here at
 *     ingest so league scoring stays a flat stat×weight sum (DST_PA weight is
 *     a scale factor).
 *   - two_pt / dst_safety / xp_att have no source at the BDL ALL-STAR tier —
 *     columns exist for a future upgrade and stay null.
 */

/** league defaults tier table: 0→10, 1-6→7, 7-13→4, 14-20→1, 21-27→0,
 *  28-34→-1, 35+→-4 (matches the DST_PA preset in utils/sports/registry.ts). */
export function dstPointsAllowedPts(pointsAllowed: number): number {
  if (pointsAllowed <= 0) return 10;
  if (pointsAllowed <= 6) return 7;
  if (pointsAllowed <= 13) return 4;
  if (pointsAllowed <= 20) return 1;
  if (pointsAllowed <= 27) return 0;
  if (pointsAllowed <= 34) return -1;
  return -4;
}

const toInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

/** NFL stat columns for one player-game, from a BDL /nfl/v1/stats row. */
export function mapNflGameStats(s: Record<string, unknown>): Record<string, number | null> {
  const kickTd = toInt(s.kick_return_touchdowns) ?? 0;
  const puntTd = toInt(s.punt_return_touchdowns) ?? 0;
  return {
    pass_att: toInt(s.passing_attempts),
    pass_cmp: toInt(s.passing_completions),
    pass_yd: toInt(s.passing_yards),
    pass_td: toInt(s.passing_touchdowns),
    pass_int: toInt(s.passing_interceptions),
    rush_att: toInt(s.rushing_attempts),
    rush_yd: toInt(s.rushing_yards),
    rush_td: toInt(s.rushing_touchdowns),
    rec: toInt(s.receptions),
    targets: toInt(s.receiving_targets),
    rec_yd: toInt(s.receiving_yards),
    rec_td: toInt(s.receiving_touchdowns),
    fum_lost: toInt(s.fumbles_lost),
    ret_td: kickTd + puntTd > 0 ? kickTd + puntTd : (toInt(s.kick_return_touchdowns) === null && toInt(s.punt_return_touchdowns) === null ? null : 0),
    fg_made: toInt(s.field_goals_made),
    fg_att: toInt(s.field_goal_attempts),
    fg_long: toInt(s.long_field_goal_made),
    xp_made: toInt(s.extra_points_made),
  };
}

export interface DstGameInput {
  /** BDL team_stats row for the DEFENSE's own team (defensive_touchdowns). */
  ownRow: Record<string, unknown> | undefined;
  /** BDL team_stats row for the OPPONENT (their giveaways = our takeaways). */
  oppRow: Record<string, unknown> | undefined;
  /** Points the opponent scored (from the game object). */
  opponentScore: number;
}

/**
 * NFL stat columns for one team-defense game. Sacks/INTs/fumble recoveries
 * come from the OPPONENT's team_stats row (sacks they took, interceptions
 * they threw, fumbles they lost); defensive TDs from the defense's own row.
 */
export function mapDstGameStats({ ownRow, oppRow, opponentScore }: DstGameInput): Record<string, number | null> {
  return {
    dst_sacks: toInt(oppRow?.sacks) ?? 0,
    dst_int: toInt(oppRow?.interceptions_thrown) ?? 0,
    dst_fum_rec: toInt(oppRow?.fumbles_lost) ?? 0,
    dst_td: toInt(ownRow?.defensive_touchdowns) ?? 0,
    dst_pts_allowed: opponentScore,
    dst_pa_pts: dstPointsAllowedPts(opponentScore),
  };
}
