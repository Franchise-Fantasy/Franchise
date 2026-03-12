import {
  baseSlotName,
  slotLabel,
  getEligiblePositions,
  isEligibleForSlot,
  isStarterSlot,
} from '@/utils/rosterSlots';

// ─── baseSlotName ───────────────────────────────────────────────────────────

describe('baseSlotName', () => {
  it('strips UTIL numbering', () => {
    expect(baseSlotName('UTIL1')).toBe('UTIL');
    expect(baseSlotName('UTIL2')).toBe('UTIL');
    expect(baseSlotName('UTIL10')).toBe('UTIL');
  });

  it('leaves non-UTIL slots unchanged', () => {
    expect(baseSlotName('PG')).toBe('PG');
    expect(baseSlotName('BE')).toBe('BE');
    expect(baseSlotName('IR')).toBe('IR');
    expect(baseSlotName('G')).toBe('G');
  });

  it('leaves bare UTIL unchanged', () => {
    expect(baseSlotName('UTIL')).toBe('UTIL');
  });
});

// ─── slotLabel ──────────────────────────────────────────────────────────────

describe('slotLabel', () => {
  it('returns label for standard positions', () => {
    expect(slotLabel('PG')).toBe('PG');
    expect(slotLabel('SG')).toBe('SG');
    expect(slotLabel('C')).toBe('C');
  });

  it('returns UTIL for numbered UTIL slots', () => {
    expect(slotLabel('UTIL1')).toBe('UTIL');
    expect(slotLabel('UTIL3')).toBe('UTIL');
  });

  it('returns BE and IR labels', () => {
    expect(slotLabel('BE')).toBe('BE');
    expect(slotLabel('IR')).toBe('IR');
  });

  it('returns slot itself for unknown slots', () => {
    expect(slotLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

// ─── getEligiblePositions ───────────────────────────────────────────────────

describe('getEligiblePositions', () => {
  it('single position returns just that position', () => {
    expect(getEligiblePositions('PG')).toEqual(['PG']);
    expect(getEligiblePositions('C')).toEqual(['C']);
  });

  it('SF-PG covers PG through SF', () => {
    expect(getEligiblePositions('SF-PG')).toEqual(['PG', 'SG', 'SF']);
  });

  it('PF-SF covers SF and PF', () => {
    expect(getEligiblePositions('PF-SF')).toEqual(['SF', 'PF']);
  });

  it('C-PF covers PF and C', () => {
    expect(getEligiblePositions('C-PF')).toEqual(['PF', 'C']);
  });

  it('SG-PG covers PG and SG', () => {
    expect(getEligiblePositions('SG-PG')).toEqual(['PG', 'SG']);
  });

  it('returns empty for invalid position', () => {
    expect(getEligiblePositions('INVALID')).toEqual([]);
  });
});

// ─── isEligibleForSlot ──────────────────────────────────────────────────────

describe('isEligibleForSlot', () => {
  it('UTIL slot accepts any position', () => {
    expect(isEligibleForSlot('PG', 'UTIL')).toBe(true);
    expect(isEligibleForSlot('C', 'UTIL1')).toBe(true);
    expect(isEligibleForSlot('SF-PG', 'UTIL2')).toBe(true);
  });

  it('BE slot accepts any position', () => {
    expect(isEligibleForSlot('PG', 'BE')).toBe(true);
    expect(isEligibleForSlot('C', 'BE')).toBe(true);
  });

  it('IR slot accepts any position', () => {
    expect(isEligibleForSlot('SG', 'IR')).toBe(true);
  });

  it('PG slot accepts PG', () => {
    expect(isEligibleForSlot('PG', 'PG')).toBe(true);
  });

  it('PG slot rejects SG', () => {
    expect(isEligibleForSlot('SG', 'PG')).toBe(false);
  });

  it('G slot accepts PG and SG', () => {
    expect(isEligibleForSlot('PG', 'G')).toBe(true);
    expect(isEligibleForSlot('SG', 'G')).toBe(true);
    expect(isEligibleForSlot('SF', 'G')).toBe(false);
  });

  it('F slot accepts SF and PF', () => {
    expect(isEligibleForSlot('SF', 'F')).toBe(true);
    expect(isEligibleForSlot('PF', 'F')).toBe(true);
    expect(isEligibleForSlot('SG', 'F')).toBe(false);
  });

  it('multi-position player: SG-SF eligible for G slot (has SG)', () => {
    expect(isEligibleForSlot('SG-SF', 'G')).toBe(true);
  });

  it('multi-position player: SF-PF eligible for F slot', () => {
    expect(isEligibleForSlot('SF-PF', 'F')).toBe(true);
  });

  it('multi-position player: PG-SG not eligible for F slot', () => {
    expect(isEligibleForSlot('PG-SG', 'F')).toBe(false);
  });
});

// ─── isStarterSlot ──────────────────────────────────────────────────────────

describe('isStarterSlot', () => {
  it('standard positions are starter slots', () => {
    expect(isStarterSlot('PG')).toBe(true);
    expect(isStarterSlot('SG')).toBe(true);
    expect(isStarterSlot('SF')).toBe(true);
    expect(isStarterSlot('PF')).toBe(true);
    expect(isStarterSlot('C')).toBe(true);
  });

  it('UTIL slots are starter slots', () => {
    expect(isStarterSlot('UTIL')).toBe(true);
    expect(isStarterSlot('UTIL1')).toBe(true);
    expect(isStarterSlot('UTIL2')).toBe(true);
  });

  it('G and F are starter slots', () => {
    expect(isStarterSlot('G')).toBe(true);
    expect(isStarterSlot('F')).toBe(true);
  });

  it('BE is not a starter slot', () => {
    expect(isStarterSlot('BE')).toBe(false);
  });

  it('IR is not a starter slot', () => {
    expect(isStarterSlot('IR')).toBe(false);
  });
});
