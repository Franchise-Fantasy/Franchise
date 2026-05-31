/**
 * Check if a player is eligible for a taxi squad slot.
 *
 * Eligibility is based on professional experience: currentYear - draft_year.
 * A player drafted in 2025 has 1 year of experience in the 2025-26 NBA season
 * (or the 2026 WNBA season).
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

/**
 * Whether a player may be SENT to the taxi squad: taxi-eligible by experience
 * AND not already promoted off taxi (promotion is one-way — a promoted player
 * can never return, even if still young enough). Single source of truth for the
 * rule so the roster page, draft room, and any edge taxi-writer enforce it
 * identically. Slot-availability / on-bench checks stay at the call site —
 * they're context-specific.
 */
export function canSendToTaxi(
  nbaDraftYear: number | null,
  currentSeason: string,
  maxExperience: number | null,
  promotedFromTaxi: boolean,
): boolean {
  if (promotedFromTaxi) return false;
  return isTaxiEligible(nbaDraftYear, currentSeason, maxExperience);
}

/** Human-readable label for a taxi max experience setting. */
export function taxiExperienceLabel(maxExperience: number | null): string {
  if (maxExperience === null) return 'No Max';
  if (maxExperience === 1) return 'Rookies Only';
  return `${maxExperience} Years`;
}
