import { checkPositionLimits, checkPositionLimitsForRoster } from '@/utils/roster/positionLimits';

describe('checkPositionLimits — single-player add', () => {
  it('returns null when there are no limits', () => {
    expect(checkPositionLimits(null, [], 'PG')).toBeNull();
    expect(checkPositionLimits({}, [], 'PG')).toBeNull();
  });

  it('returns null when adding a player would not exceed the limit', () => {
    const limits = { PG: 3 };
    const roster = [
      { position: 'PG', roster_slot: 'PG' },
      { position: 'PG', roster_slot: 'BE' },
    ];
    // Adding a 3rd PG hits the cap of 3 — but check is `>=` so 2 active PGs blocks the 3rd add.
    // Reading impl: returns violation when current >= max. 2 >= 3 is false → ok.
    expect(checkPositionLimits(limits, roster, 'PG')).toBeNull();
  });

  it('blocks the add when at cap', () => {
    const limits = { PG: 2 };
    const roster = [
      { position: 'PG', roster_slot: 'PG' },
      { position: 'PG', roster_slot: 'BE' },
    ];
    const violation = checkPositionLimits(limits, roster, 'PG');
    expect(violation).toEqual({ position: 'PG', current: 2, max: 2 });
  });

  it('excludes IR and TAXI players from the count', () => {
    const limits = { PG: 2 };
    const roster = [
      { position: 'PG', roster_slot: 'PG' },
      { position: 'PG', roster_slot: 'IR' },     // exempt
      { position: 'PG', roster_slot: 'TAXI' },   // exempt
    ];
    // Active PG count = 1; adding another → 2 total, but check happens before add. 1 < 2 → ok.
    expect(checkPositionLimits(limits, roster, 'PG')).toBeNull();
  });

  it('NBA spectrum: a SG-SF can match SG, SF, G, or F limits', () => {
    const limits = { G: 3 };
    const roster = [
      { position: 'SG', roster_slot: 'BE' },
      { position: 'PG', roster_slot: 'BE' },
      { position: 'PG', roster_slot: 'BE' },
    ];
    // Active G-eligible count = 3 (2 PG + 1 SG); at cap → blocks any new G.
    const violation = checkPositionLimits(limits, roster, 'SG');
    expect(violation).not.toBeNull();
    expect(violation!.position).toBe('G');
  });

  it('ignores a limit of null or 0', () => {
    expect(checkPositionLimits({ PG: null }, [{ position: 'PG' }], 'PG')).toBeNull();
    expect(checkPositionLimits({ PG: 0 }, [{ position: 'PG' }], 'PG')).toBeNull();
  });

  it('does not block when the incoming position is unrelated to any limit', () => {
    const limits = { PG: 2 };
    const roster = [{ position: 'PG' }, { position: 'PG' }];
    expect(checkPositionLimits(limits, roster, 'C')).toBeNull();
  });

  it('primary position only: a PF-C counts toward PF, not C', () => {
    const limits = { C: 1 };
    const roster = [{ position: 'PF-C', roster_slot: 'BE' }];
    // PF-C's primary is PF, so it doesn't count toward the C cap.
    expect(checkPositionLimits(limits, roster, 'PF-C')).toBeNull();
  });

  it('primary position only: a C-PF counts toward C', () => {
    const limits = { C: 1 };
    const roster = [{ position: 'C-PF', roster_slot: 'BE' }];
    const violation = checkPositionLimits(limits, roster, 'C-PF');
    expect(violation).toEqual({ position: 'C', current: 1, max: 1 });
  });
});

describe('checkPositionLimitsForRoster — whole-roster check', () => {
  it('returns null for empty limits', () => {
    expect(checkPositionLimitsForRoster(null, [])).toBeNull();
  });

  it('returns the violation when an over-count exists', () => {
    const limits = { C: 1 };
    const roster = [
      { position: 'C', roster_slot: 'C' },
      { position: 'C', roster_slot: 'BE' },
    ];
    const violation = checkPositionLimitsForRoster(limits, roster);
    expect(violation).toEqual({ position: 'C', count: 2, max: 1 });
  });

  it('ignores IR/TAXI bodies for limit math', () => {
    const limits = { PG: 1 };
    const roster = [
      { position: 'PG', roster_slot: 'PG' },
      { position: 'PG', roster_slot: 'IR' },
      { position: 'PG', roster_slot: 'TAXI' },
    ];
    // Active count is 1, max 1 → fine.
    expect(checkPositionLimitsForRoster(limits, roster)).toBeNull();
  });

  it('returns null when every position is under cap', () => {
    const limits = { PG: 3, SG: 3, C: 2 };
    const roster = [
      { position: 'PG' },
      { position: 'SG' },
      { position: 'C' },
    ];
    expect(checkPositionLimitsForRoster(limits, roster)).toBeNull();
  });
});
