import { resolveSwap, SwapSpec } from '@/utils/league/pickSwapResolution';

// Minimal pick shape for the pure resolver: round + owner + a slot we control.
interface P {
  id: string;
  round: number;
  current_team_id: string | null;
  slot: number;
}

const slotOf = (p: P) => p.slot;

function pick(id: string, round: number, owner: string, slot: number): P {
  return { id, round, current_team_id: owner, slot };
}

describe('resolveSwap', () => {
  const swap: SwapSpec = { round: 1, beneficiary_team_id: 'A', counterparty_team_id: 'B' };

  it('executes when the counterparty holds the better (lower-slot) pick', () => {
    const picks = [pick('pA', 1, 'A', 5), pick('pB', 1, 'B', 2)];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('executed');
    if (out.kind !== 'executed') return;
    expect(out.benefPick.id).toBe('pA');
    expect(out.counterPick.id).toBe('pB');
  });

  it('keeps when the beneficiary already holds the better pick', () => {
    const picks = [pick('pA', 1, 'A', 2), pick('pB', 1, 'B', 5)];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('kept');
  });

  it('keeps on an exact slot tie (no ownership churn for equal picks)', () => {
    const picks = [pick('pA', 1, 'A', 3), pick('pB', 1, 'B', 3)];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('kept');
  });

  it('voids when the beneficiary holds no pick in the round', () => {
    const picks = [pick('pB', 1, 'B', 2)];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('voided');
    if (out.kind !== 'voided') return;
    expect(out.benefPresent).toBe(false);
    expect(out.counterPresent).toBe(true);
  });

  it('voids when both teams hold no pick in the round', () => {
    const picks = [pick('pC', 1, 'C', 1)];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('voided');
    if (out.kind !== 'voided') return;
    expect(out.benefPresent).toBe(false);
    expect(out.counterPresent).toBe(false);
  });

  it('best-pick: when the counterparty holds TWO picks, puts up its best one', () => {
    // B holds slot 4 and slot 1 in the round; A holds slot 3. B's best (slot 1)
    // beats A's slot 3 → executed against the slot-1 pick, not the arbitrary first.
    const picks = [
      pick('pA', 1, 'A', 3),
      pick('pB_bad', 1, 'B', 4),
      pick('pB_good', 1, 'B', 1),
    ];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('executed');
    if (out.kind !== 'executed') return;
    expect(out.counterPick.id).toBe('pB_good');
  });

  it('best-pick: when the beneficiary holds TWO picks, compares its best', () => {
    // A holds slot 2 and slot 5; B holds slot 3. A's best (slot 2) already
    // beats B → kept, and the compared beneficiary pick is the good one.
    const picks = [
      pick('pA_good', 1, 'A', 2),
      pick('pA_bad', 1, 'A', 5),
      pick('pB', 1, 'B', 3),
    ];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('kept');
    if (out.kind !== 'kept') return;
    expect(out.benefPick.id).toBe('pA_good');
  });

  it('only considers picks in the swap round', () => {
    // A's better pick is in round 2 — must be ignored for a round-1 swap.
    const picks = [
      pick('pA_r1', 1, 'A', 5),
      pick('pA_r2', 2, 'A', 1),
      pick('pB_r1', 1, 'B', 2),
    ];
    const out = resolveSwap(picks, swap, slotOf);
    expect(out.kind).toBe('executed');
    if (out.kind !== 'executed') return;
    expect(out.benefPick.id).toBe('pA_r1');
  });

  it('does not mutate the input picks', () => {
    const picks = [pick('pA', 1, 'A', 5), pick('pB', 1, 'B', 2)];
    resolveSwap(picks, swap, slotOf);
    expect(picks[0].current_team_id).toBe('A');
    expect(picks[1].current_team_id).toBe('B');
  });
});
