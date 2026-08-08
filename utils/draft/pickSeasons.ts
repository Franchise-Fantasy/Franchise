import {
  formatSeason,
  parseSeasonStartYear,
  rookieDraftStartOffset,
  type Sport,
} from '@/constants/LeagueDefaults';

/**
 * The season windows every draft-pick surface filters on.
 *
 * These used to be hand-rolled in four places (useDraftHub, tradablePicks,
 * useLeagueTradeConditions, ManagePickConditionsModal) and they drifted: the
 * draft hub's window was one year SHORT of the tradable horizon, so an
 * imported league's outermost year of picks was tradeable on the roster page
 * and in the trade builder but invisible in the hub. Two of the copies also
 * hardcoded the NBA "2027-28" season format, which never matches a WNBA/NFL
 * league's single-year picks.
 *
 * The horizon: a league's pick rows always span `season` .. `season +
 * max_future_seasons` in start-years. `buildFutureDraftPicks` seeds offsets
 * 1..N at creation, the imports additionally seed offset 0 when they land the
 * league mid-offseason, and `execute-trade` validates swaps against the same
 * inclusive `[S, S+N]` range.
 */

/**
 * Seasons that have a ROOKIE draft a team can still hold picks in — the draft
 * hub's year tabs, the swap-season picker, and the commissioner's pick-
 * conditions tool.
 *
 * Starts at `rookieDraftStartOffset` (offset 0 while a league sits in its
 * offseason before the rookie draft commits, since `advance-season` already
 * rolled `league.season` forward and that draft is for `season` itself;
 * offset 1 otherwise) and runs to the end of the tradable horizon. The first
 * entry is the UPCOMING draft — callers rely on that (`validSeasons[0]`).
 */
export function rookiePickSeasons(
  season: string,
  maxFutureSeasons: number,
  offseasonStep: string | null | undefined,
  sport: Sport,
): string[] {
  const startYear = parseSeasonStartYear(season);
  const seasons: string[] = [];
  for (let offset = rookieDraftStartOffset(offseasonStep); offset <= maxFutureSeasons; offset++) {
    seasons.push(formatSeason(startYear + offset, sport));
  }
  return seasons;
}

/**
 * Every season a team can hold a tradable pick in. Same horizon as
 * `rookiePickSeasons` but always includes the current season, whose picks
 * belong to an in-progress STARTUP draft — they're only tradable until they're
 * used, and a used pick carries a `player_id` that callers already filter out.
 */
export function tradablePickSeasons(
  season: string,
  maxFutureSeasons: number,
  sport: Sport,
): string[] {
  const startYear = parseSeasonStartYear(season);
  const seasons: string[] = [];
  for (let offset = 0; offset <= maxFutureSeasons; offset++) {
    seasons.push(formatSeason(startYear + offset, sport));
  }
  return seasons;
}
