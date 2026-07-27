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

/** Order a rookie-draft pool by prospect rank.
 *
 *  Prospects have no pro stat line, so every stat sort ties at zero and the pool
 *  comes back in whatever order the statless rows landed in — a ranking is the
 *  only meaningful order. `primary` is the selected ranking (consensus or the
 *  viewer's own board) and `secondary` is the other one, so a prospect ranked on
 *  only one of the two still beats a wholly unranked one; name breaks the final
 *  tie. Returns a new array — the input is not mutated. */
export function sortRookiePool<T extends { player_id: string; name: string }>(
  players: T[],
  primary: Map<string, number> | undefined,
  secondary: Map<string, number> | undefined,
): T[] {
  // MAX_SAFE_INTEGER, not Infinity — Infinity - Infinity is NaN, which makes the
  // comparator inconsistent for the (common) unranked-vs-unranked pair.
  const rank = (ranks: Map<string, number> | undefined, p: T) =>
    ranks?.get(p.player_id) ?? Number.MAX_SAFE_INTEGER;
  return [...players].sort(
    (a, b) =>
      rank(primary, a) - rank(primary, b) ||
      rank(secondary, a) - rank(secondary, b) ||
      a.name.localeCompare(b.name),
  );
}

/** Roster-completion guard for the autodraft bot. A pure best-available bot
 *  never reaches for the low-scoring mandatory positions — in an NFL draft
 *  every skill player outscores every K and D/ST, so left alone the bot spends
 *  all its picks on QB/RB/WR/TE, leaves the K and DST starter slots empty
 *  forever, and overflows the bench. Once the team's remaining picks are only
 *  enough to cover its vacant starter slots, restrict the candidate pool to
 *  players who can still fill one of those slots.
 *
 *  Vacancy accounting mirrors the draft slot assigner (findBestSlot in
 *  autodraft/make-draft-pick): a slot counts as filled only by players whose
 *  roster_slot IS that slot (UTIL occupies numbered UTIL1..n).
 *
 *  Sport-agnostic by construction, but callers currently gate it to NFL so
 *  basketball autodraft behavior stays byte-identical. `isEligibleForSlot` is
 *  a parameter (not an import) to keep this module zero-dep — pass the one
 *  from utils/roster/rosterSlotsShared. Returns `ranked` unchanged when the
 *  guard doesn't bind, and falls back to `ranked` if no candidate can fill any
 *  vacancy (deadlock prevention — a wrong pick beats a stuck draft). */
export function restrictToRosterNeeds<T extends { position: string }>(input: {
  ranked: T[];
  configs: { position: string; slot_count: number }[];
  roster: { roster_slot: string | null }[];
  remainingPicks: number;
  isEligibleForSlot: (position: string, slot: string) => boolean;
}): T[] {
  const { ranked, configs, roster, remainingPicks, isEligibleForSlot } = input;

  const vacancies: { slot: string; open: number }[] = [];
  for (const config of configs) {
    if (config.position === 'BE' || config.position === 'IR' || config.position === 'TAXI') continue;
    let filled = 0;
    for (const p of roster) {
      const slot = p.roster_slot ?? '';
      if (config.position === 'UTIL' ? slot.startsWith('UTIL') : slot === config.position) filled++;
    }
    const open = config.slot_count - filled;
    if (open > 0) vacancies.push({ slot: config.position, open });
  }

  const totalOpen = vacancies.reduce((sum, v) => sum + v.open, 0);
  if (totalOpen === 0 || remainingPicks > totalOpen) return ranked;

  const fillers = ranked.filter((candidate) =>
    vacancies.some((v) => isEligibleForSlot(candidate.position, v.slot)),
  );
  return fillers.length > 0 ? fillers : ranked;
}
