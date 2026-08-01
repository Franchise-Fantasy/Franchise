/**
 * When a season's incoming rookie class is actually in the player pool.
 *
 * A league can't hold next season's draft the moment the old one ends: the
 * rookies haven't been drafted by their real league yet, so `sync-players`
 * hasn't ingested them. Drafting early means drafting last year's class.
 *
 * The authoritative per-season answer is `season_config.creation_opens_at`
 * (already picked to land after each sport's real draft — it's the same date
 * that gates next-season league creation). When a season has no config row
 * yet, fall back to the recurring per-sport month/day.
 *
 * Zero deps — no `@/` aliases, no `react-native`, no Deno globals — so this
 * file is importable from both Metro (client) and Deno (edge functions).
 *
 * Consumed by:
 *   - constants/LeagueDefaults.ts (client; reads the season-config cache)
 *   - supabase/functions/open-draft-season/index.ts (edge; the gate itself)
 */

/**
 * Recurring month/day per sport when that season's rookie class is in the pool.
 * NBA: post-late-June draft (Jul 1, pre-Summer League). WNBA: post-mid-April
 * draft (Apr 20, weeks before the mid-May tipoff). NFL: post-late-April draft.
 * Adjust as the calendar shifts; per-season overrides live in
 * `season_config.creation_opens_at`.
 */
export const SPORT_ROOKIE_CLASS_OPENS: Record<
  string,
  { month: number; day: number } | undefined
> = {
  nba: { month: 7, day: 1 },
  wnba: { month: 4, day: 20 },
  nfl: { month: 5, day: 1 },
  nhl: undefined,
  mlb: undefined,
};

/** "2026-27" → 2026, "2027" → 2027. */
export function seasonStartYear(season: string): number {
  return parseInt(season.split('-')[0], 10);
}

/**
 * The date `season`'s rookie class becomes draftable, as "YYYY-MM-DD".
 *
 * ISO rather than a `Date` so callers compare it lexicographically against a
 * sport-local day string (`getSportToday`) — no timezone to get wrong.
 *
 * `creationOpensAt` is that season's `season_config.creation_opens_at`; pass
 * null/undefined when there's no row. Returns null for a sport with no known
 * draft calendar, which callers must treat as "no gate" (never as "closed").
 */
export function rookieClassAvailableDate(
  sport: string,
  season: string,
  creationOpensAt: string | null | undefined,
): string | null {
  if (creationOpensAt) return creationOpensAt;

  const opens = SPORT_ROOKIE_CLASS_OPENS[sport];
  if (!opens) return null;

  const year = seasonStartYear(season);
  if (!Number.isFinite(year)) return null;

  const mm = String(opens.month).padStart(2, '0');
  const dd = String(opens.day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Is the rookie class for `season` in the pool as of `todayISO`?
 *
 * A sport with no known draft calendar has no gate, so it's always open —
 * better to let an unrecognized sport draft than to strand it in a dormant
 * offseason forever.
 */
export function isRookieClassAvailable(
  sport: string,
  season: string,
  creationOpensAt: string | null | undefined,
  todayISO: string,
): boolean {
  const gate = rookieClassAvailableDate(sport, season, creationOpensAt);
  if (!gate) return true;
  return todayISO >= gate;
}
