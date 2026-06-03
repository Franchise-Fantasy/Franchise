// Single source of truth for the per-pick clock, shared by start-draft,
// make-draft-pick, and autodraft. Keeping the round-acceleration math here
// (rather than copy-pasted into each function) means the three runtimes can
// never drift on how long a given pick should be — a drift would let the
// client countdown, the QStash autopick delay, and the snapshotted limit
// disagree on the same pick.

export interface DraftClockConfig {
  time_limit: number;
  picks_per_round: number | null;
  accelerate_after_round: number | null;
  accelerated_time_limit: number | null;
}

/** 1-based round number for a pick (pick 1 → round 1). Falls back to a
 *  single-pick round when picks_per_round is missing so we never divide by 0. */
export function roundForPick(pickNumber: number, picksPerRound: number | null): number {
  const ppr = picksPerRound && picksPerRound > 0 ? picksPerRound : 1;
  return Math.ceil(pickNumber / ppr);
}

/** Effective seconds-on-the-clock for a pick, honoring the optional
 *  "speed up after round N" setting. Returns the base `time_limit` unless
 *  BOTH acceleration fields are set AND the pick is past the threshold. */
export function effectiveTimeLimit(pickNumber: number, draft: DraftClockConfig): number {
  const { accelerate_after_round, accelerated_time_limit } = draft;
  if (accelerate_after_round == null || accelerated_time_limit == null) {
    return draft.time_limit;
  }
  const round = roundForPick(pickNumber, draft.picks_per_round);
  return round > accelerate_after_round ? accelerated_time_limit : draft.time_limit;
}
