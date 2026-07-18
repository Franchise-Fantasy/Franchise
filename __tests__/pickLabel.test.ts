import { formatPickLabel, formatPickLabelShort } from '@/types/trade';

// Regression cover for the trade-picker "glitched pick numbers" report:
// the label used to render `slot_number` (a team's round-relative draft slot),
// so round 1 and round 2 of the same year both read "Pick 8", and a future
// pick — whose slot_number is only a placeholder from buildFutureDraftPicks —
// rendered a confident, meaningless "Pick 3". The label now takes the overall
// `pick_number`, which is null precisely when the draft order isn't set yet.
describe('formatPickLabel', () => {
  it('omits the pick number when the draft order is not yet determined', () => {
    expect(formatPickLabel('2027-28', 1, null)).toBe('2027 1st');
    expect(formatPickLabel('2031-32', 2, null)).toBe('2031 2nd');
    expect(formatPickLabel('2029-30', 1, undefined)).toBe('2029 1st');
    expect(formatPickLabel('2029-30', 1)).toBe('2029 1st');
  });

  it('gives a round-1 and a round-2 pick in the same year different numbers', () => {
    // 10-team league, team drafting 8th: pick 8 in round 1, pick 18 in round 2.
    const round1 = formatPickLabel('2026-27', 1, 8);
    const round2 = formatPickLabel('2026-27', 2, 18);

    expect(round1).toBe('2026 1st · Pick 8');
    expect(round2).toBe('2026 2nd · Pick 18');
    expect(round1).not.toBe(round2);
  });

  it('labels the season by its start year — the draft happens in summer', () => {
    expect(formatPickLabel('2026-27', 1, 1)).toBe('2026 1st · Pick 1');
    expect(formatPickLabelShort('2026-27', 1)).toBe("'26 1st");
  });

  it('falls back to a numeric ordinal past the named rounds', () => {
    expect(formatPickLabel('2026-27', 6, null)).toBe('2026 6th');
  });
});
