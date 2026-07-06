/**
 * Shared, pure core for resolving a single pick swap — used by BOTH the
 * authoritative lottery resolution (supabase/functions/start-lottery) and the
 * client draft-hub preview (components/draft-hub/ByYearTab). Keeping the
 * decision logic here means the preview can't drift from what the lottery
 * actually commits.
 *
 * The two callers differ only in where a pick's round position comes from:
 *   - lottery: the drawn `slot_number`
 *   - preview: a reverse-standings projection
 * so the comparison is parameterized by `slotOf`. Lower slot = better pick.
 *
 * Best-pick semantics: a swap is between TEAMS, not specific picks. When a team
 * holds more than one pick in the round (common after trades), the swap puts up
 * that team's BEST pick — never an arbitrary one. Callers own the mutation and
 * any event/label side-effects; this only decides what happens.
 */

export interface SwapResolvablePick {
  round: number;
  current_team_id: string | null;
}

export interface SwapSpec {
  round: number;
  beneficiary_team_id: string;
  counterparty_team_id: string;
}

export type SwapOutcome<T> =
  /** Beneficiary takes the counterparty's better pick — caller swaps ownership. */
  | { kind: 'executed'; benefPick: T; counterPick: T }
  /** Beneficiary's own pick was already better/equal — no ownership change. */
  | { kind: 'kept'; benefPick: T; counterPick: T }
  /** One or both teams hold no pick in the round — swap can't resolve. */
  | { kind: 'voided'; benefPresent: boolean; counterPresent: boolean };

/** The team's best (lowest-slot) pick among the ones it currently holds in the round. */
function bestHeldPick<T extends SwapResolvablePick>(
  picks: T[],
  teamId: string,
  round: number,
  slotOf: (p: T) => number,
): T | null {
  const held = picks.filter((p) => p.round === round && p.current_team_id === teamId);
  if (held.length === 0) return null;
  return held.reduce((best, p) => (slotOf(p) < slotOf(best) ? p : best));
}

/**
 * Decide the outcome of one swap against the CURRENT ownership in `picks`.
 * Pure — does not mutate. `slotOf` returns a pick's round position (lower =
 * better); provide a large sentinel for unknown positions.
 */
export function resolveSwap<T extends SwapResolvablePick>(
  picks: T[],
  swap: SwapSpec,
  slotOf: (p: T) => number,
): SwapOutcome<T> {
  const benefPick = bestHeldPick(picks, swap.beneficiary_team_id, swap.round, slotOf);
  const counterPick = bestHeldPick(picks, swap.counterparty_team_id, swap.round, slotOf);

  if (!benefPick || !counterPick) {
    return { kind: 'voided', benefPresent: !!benefPick, counterPresent: !!counterPick };
  }

  return slotOf(counterPick) < slotOf(benefPick)
    ? { kind: 'executed', benefPick, counterPick }
    : { kind: 'kept', benefPick, counterPick };
}
