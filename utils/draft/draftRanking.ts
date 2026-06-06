// Shared draft-ranking primitives used by BOTH the autodraft edge function
// (supabase/functions/autodraft) and the client draft board
// (components/draft/AvailablePlayers) so the bot pool and the human board can
// never disagree on how a player's draft value is computed. Pure logic, no
// imports — safe to import from the Deno edge runtime and from Metro alike.
// Pattern (b) "shared core" per CLAUDE.md.

// Games-played threshold below which the current-season sample is too thin to
// trust, so callers prefer a projection (or last-season production) over the
// live average. ~25% of a WNBA season; mirrors the spirit of
// ANALYTICS_MIN_CURRENT_SEASON_GAMES in utils/scoring/fantasyPoints.ts.
export const DRAFT_PROJECTION_GAME_THRESHOLD = 5;

/** True when a player has played fewer than the threshold games this season,
 *  so callers should show / rank by a projection instead of current averages. */
export function preferProjection(gamesPlayed: number | null | undefined): boolean {
  return (gamesPlayed ?? 0) < DRAFT_PROJECTION_GAME_THRESHOLD;
}

/** A player's effective per-game points for draft ranking: the current-season
 *  average once they've played enough games this season, otherwise the season
 *  projection, then last-season production, then whatever current value exists
 *  (which may be 0 in the preseason). Keeps the bot draft pool ordered like the
 *  human draft board even pre-tipoff, when current-season avg_pts is NULL for
 *  everyone and a raw avg_pts sort would surface statless fringe players. */
export function effectiveDraftPts(input: {
  gamesPlayed: number | null | undefined;
  currentAvgPts: number | null | undefined;
  seasonProjPts?: number | null;
  lastSeasonAvgPts?: number | null;
}): number {
  const { gamesPlayed, currentAvgPts, seasonProjPts, lastSeasonAvgPts } = input;
  if (!preferProjection(gamesPlayed) && currentAvgPts != null) return currentAvgPts;
  return seasonProjPts ?? lastSeasonAvgPts ?? currentAvgPts ?? 0;
}
