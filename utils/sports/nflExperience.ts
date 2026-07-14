/**
 * Deriving `players.draft_year` for NFL from BDL's `experience` string.
 *
 * Zero-dep on purpose — imported by Metro (client), Deno (sync-players), and
 * jest. No react-native, no supabase.
 *
 * Taxi-squad eligibility is years-of-experience, which the app computes as
 * `currentYear - draft_year` (see utils/roster/taxiEligibility.ts). BDL's NFL
 * players feed has **no draft_year field** (basketball's does), which is why NFL
 * shipped with taxi disabled. It does, however, carry `experience` — and that
 * turns out to be exactly the number we need.
 *
 * BDL's `experience` counts the upcoming season INCLUSIVELY: a player drafted in
 * 2017 reads "10th Season" for the 2026 season (2017…2026 = 10). So:
 *
 *     N = referenceSeason + 1 - draftYear     →     draftYear = referenceSeason + 1 - N
 *
 * Verified 2026-07-13 against the live feed: every 2025 first-rounder (Ward,
 * Hunter, Carter, Jeanty, McMillan, Warren, Hampton) reads "2nd Season"; every
 * 2024 first-rounder (C. Williams, Daniels, Nabers, Bowers) reads "3rd Season";
 * and veterans invert correctly (Mahomes '17 → 10th, Chase '21 → 6th, Barkley
 * '18 → 9th, Purdy '22 → 5th, Nacua '23 → 4th, Kelce '13 → 14th, Rodgers '05 →
 * 22nd).
 *
 * ⚠ "1st Season" is NOT a draft class and must not be mapped to N=1. Its 279
 * players run ages 22–29 (median 25), while the actual rookie class — the
 * "Rookie" bucket, 670 players — runs 20–28 (median 22). It is BDL's label for
 * players with no *accrued* season: camp and practice-squad bodies who entered
 * the league an unknown number of years ago. Mapping it to the current draft
 * year would hand all 279 a rookie's draft_year and make a 29-year-old career
 * practice-squad player taxi-eligible as a rookie. It returns null instead
 * (unknown → not taxi-eligible). The cost is that a genuine UDFA can't be taxi-
 * stashed; the alternative silently opens the squad to non-rookies, and these
 * are fringe players nobody rosters either way.
 *
 * The "Rookie" bucket is clean: of the 231 that landed in our pool, exactly one
 * has a prior-season stat line (a WR with 5 catches — BDL's own labelling slip).
 *
 * ⚠ Pagination hazard: BDL rate-limits `/players/active` (30 pages at 100/page).
 * A 429 swallowed mid-pagination yields a partial page whose `experience` values
 * are wrong — an early pass at this file read Kelce as "1st Season" that way.
 * Any re-derivation must retry on 429 and hard-fail on a non-OK page.
 */

/** BDL's "Nth Season" ordinal. "Rookie" is the label for a first-year player. */
const ORDINAL_SEASON = /^(\d+)(?:st|nd|rd|th) Season$/i;

/**
 * The NFL season BDL's `experience` is counting — i.e. the season whose draft
 * has already happened. Derived from the calendar rather than `season_config`
 * so it can't drift when the app's current-season flip lags the draft.
 *
 * Boundary is May, not January: the draft is late April, so from May onward the
 * new class exists and BDL counts the new season. Before that, BDL is still
 * counting the season just played.
 */
export function nflReferenceSeason(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 4 ? year : year - 1;
}

/**
 * BDL `experience` → the year the player entered the league, or null when it
 * can't be trusted. Null means "unknown", which reads downstream as
 * not-taxi-eligible.
 */
export function nflDraftYearFromExperience(
  experience: string | null | undefined,
  referenceSeason: number,
): number | null {
  if (!experience) return null;
  const value = experience.trim();

  // The one clean first-year label.
  if (/^rookie$/i.test(value)) return referenceSeason;

  const match = ORDINAL_SEASON.exec(value);
  if (!match) return null;

  const seasons = parseInt(match[1], 10);
  // N=1 is the "1st Season" no-accrued-season bucket (see the file header) — a
  // real first-year player is labelled "Rookie", never "1st Season".
  if (!Number.isInteger(seasons) || seasons < 2) return null;

  const draftYear = referenceSeason + 1 - seasons;
  // Sanity floor: nobody in an active pool entered before 1990. Guards against
  // a malformed ordinal ("99th Season") poisoning the column.
  return draftYear >= 1990 && draftYear <= referenceSeason ? draftYear : null;
}
