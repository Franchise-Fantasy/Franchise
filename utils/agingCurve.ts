import { AGING_CURVES, type PositionCurve } from '@/constants/agingCurves';

/**
 * Map a player's position string (e.g. "PG-SG", "SF", "G") to the best
 * matching curve key. Falls back to "ALL" if no match.
 */
export function getPositionCurveKey(position: string | null | undefined): PositionCurve {
  if (!position) return 'ALL';

  const primary = position.split('-')[0].toUpperCase().trim();
  const valid: PositionCurve[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'];

  if (valid.includes(primary as PositionCurve)) return primary as PositionCurve;
  return 'ALL';
}

/**
 * Look up the expected production multiplier for a given position and age.
 * Uses the baseline (all rotation players) normalized curves for projections.
 * Interpolates linearly between integer ages for fractional values.
 * Returns a value where 1.0 = peak production.
 */
export function getCurveValue(position: string | null | undefined, age: number): number {
  const key = getPositionCurveKey(position);
  const curves = AGING_CURVES.baseline.curves;
  const curve = curves[key] ?? curves['ALL'];
  if (!curve) return 1;

  const lower = Math.floor(age);
  const upper = Math.ceil(age);
  const fraction = age - lower;

  const lowerVal = curve[String(lower)];
  const upperVal = curve[String(upper)];

  if (lowerVal == null && upperVal == null) return 1;
  if (lowerVal == null) return upperVal!;
  if (upperVal == null) return lowerVal;

  return lowerVal + (upperVal - lowerVal) * fraction;
}

/**
 * Project a player's FPTS/game from their current age to a target age
 * using the population aging curve.
 */
export function projectFpts(
  currentFpts: number,
  currentAge: number,
  targetAge: number,
  position: string | null | undefined,
): number {
  const currentCurveVal = getCurveValue(position, currentAge);
  const targetCurveVal = getCurveValue(position, targetAge);

  if (currentCurveVal <= 0) return currentFpts;
  return Math.round((currentFpts * (targetCurveVal / currentCurveVal)) * 100) / 100;
}

/**
 * Get the sample size for a given position and age bucket.
 * Useful for showing confidence in the curve at extreme ages.
 */
export function getSampleSize(position: string | null | undefined, age: number): number {
  const key = getPositionCurveKey(position);
  const samples = AGING_CURVES.baseline.sampleSizes[key] ?? AGING_CURVES.baseline.sampleSizes['ALL'];
  return samples?.[String(Math.floor(age))] ?? 0;
}
