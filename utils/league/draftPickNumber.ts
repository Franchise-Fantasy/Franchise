/**
 * Continuous pick number across rounds: R2 slot 1 reads as 11, 12, … in a
 * 10-team league rather than restarting at 1. Every round has exactly one slot
 * per team, so each prior round adds `teamCount` to the offset.
 *
 * `slot` stays the within-round position (that's what protection thresholds
 * like "Top-4" compare against) — this is display only.
 */
export function overallPickNumber(round: number, slot: number, teamCount: number): number {
  return (round - 1) * teamCount + slot;
}
