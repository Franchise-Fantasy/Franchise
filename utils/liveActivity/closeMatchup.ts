/**
 * Pure closeness rules for the Sunday close-matchup scanner.
 *
 * Shared between supabase/functions/scan-close-matchups/index.ts and the unit
 * tests. Tuning the thresholds here is a deliberate product decision — bump
 * with care.
 */

export const POINTS_FLAT_THRESHOLD = 30;
export const POINTS_PERCENT_THRESHOLD = 0.15;
export const CATEGORY_GAP_MAX = 1;
export const CATEGORY_MIN_DECIDED = 3;

/** A points-league matchup is "close" if the gap is small in absolute or
 *  relative terms — roughly "one starter's night could swing it". */
export function pointsClose(home: number, away: number): boolean {
  const gap = Math.abs(home - away);
  if (gap <= POINTS_FLAT_THRESHOLD) return true;
  const leader = Math.max(home, away, 1);
  return gap / leader <= POINTS_PERCENT_THRESHOLD;
}

/** A categories-league matchup is "close" if it's tied or one category apart,
 *  with enough decided categories to not be noise on a slow week. */
export function categoriesClose(
  homeWins: number,
  awayWins: number,
  ties: number,
): boolean {
  const decided = homeWins + awayWins + ties;
  if (decided < CATEGORY_MIN_DECIDED) return false;
  return Math.abs(homeWins - awayWins) <= CATEGORY_GAP_MAX;
}
