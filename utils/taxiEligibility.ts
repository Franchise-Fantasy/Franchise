/**
 * Check if a player is eligible for a taxi squad slot.
 *
 * Eligibility is based on NBA experience: currentYear - draft_year.
 * A player drafted in 2025 has 1 year of experience in the 2025-26 season.
 */
export function isTaxiEligible(
  nbaDraftYear: number | null,
  currentSeason: string,
  maxExperience: number | null,
): boolean {
  if (maxExperience === null) return true;
  if (nbaDraftYear === null) return false;
  const currentYear = parseInt(currentSeason.split('-')[0], 10) + 1;
  const experience = currentYear - nbaDraftYear;
  return experience >= 0 && experience <= maxExperience;
}

/** Human-readable label for a taxi max experience setting. */
export function taxiExperienceLabel(maxExperience: number | null): string {
  if (maxExperience === null) return 'No Max';
  if (maxExperience === 1) return 'Rookies Only';
  return `${maxExperience} Years`;
}
