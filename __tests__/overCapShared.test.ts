import { computeOverCapState, formatOverCapError } from '@/utils/roster/overCapShared';

describe('computeOverCapState', () => {
  it('reports under-cap when active <= rosterSize', () => {
    const s = computeOverCapState(12, 13);
    expect(s).toEqual({ activeCount: 12, rosterSize: 13, isOver: false, overBy: 0 });
  });

  it('reports under-cap when active === rosterSize (cap is inclusive)', () => {
    const s = computeOverCapState(13, 13);
    expect(s.isOver).toBe(false);
    expect(s.overBy).toBe(0);
  });

  it('reports over-cap with correct overBy', () => {
    const s = computeOverCapState(15, 13);
    expect(s.isOver).toBe(true);
    expect(s.overBy).toBe(2);
    expect(s.activeCount).toBe(15);
    expect(s.rosterSize).toBe(13);
  });

  it('applies exemptCount before comparing', () => {
    // 15 active - 3 exempt = 12 effective; cap 13 → not over.
    const s = computeOverCapState(15, 13, 3);
    expect(s.isOver).toBe(false);
    expect(s.overBy).toBe(0);
    // activeCount preserves the raw input (display value).
    expect(s.activeCount).toBe(15);
  });

  it('clamps overBy at zero when exemptCount exceeds activeCount', () => {
    const s = computeOverCapState(5, 13, 99);
    expect(s.isOver).toBe(false);
    expect(s.overBy).toBe(0);
  });
});

describe('formatOverCapError', () => {
  it('uses "player" (singular) when overBy is 1', () => {
    const msg = formatOverCapError({ activeCount: 14, rosterSize: 13, isOver: true, overBy: 1 });
    expect(msg).toContain('Drop or move 1 player to taxi or IR');
    expect(msg).toContain('14 players');
    expect(msg).toContain('only 13 are allowed');
  });

  it('uses "players" (plural) when overBy > 1', () => {
    const msg = formatOverCapError({ activeCount: 15, rosterSize: 13, isOver: true, overBy: 2 });
    expect(msg).toContain('Drop or move 2 players to taxi or IR');
  });
});
