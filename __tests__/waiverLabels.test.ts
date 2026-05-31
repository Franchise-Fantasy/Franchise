import { getProcessDate, getWaiverBadgeLabel, isOnWaivers } from '@/utils/freeAgent/waiverLabels';

// Captured at module load time (before jest mocks Date) — pass as a raw epoch
// number because setSystemTime in this jest version rejects Date instances
// constructed under the mocked clock.
const FIXED_NOW_MS = new Date(2026, 1, 4, 12, 0, 0).getTime(); // Wed 2026-02-04 12:00 local

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(FIXED_NOW_MS);
});

afterAll(() => {
  jest.useRealTimers();
});

describe('isOnWaivers', () => {
  it('returns false in a no-waivers league', () => {
    expect(isOnWaivers('p1', 'none', new Map())).toBe(false);
  });

  it('returns true for any add in a FAAB league', () => {
    expect(isOnWaivers('p1', 'faab', new Map())).toBe(true);
    expect(isOnWaivers('p1', 'faab', undefined)).toBe(true);
  });

  it('standard waivers: true iff player has an on_waivers_until entry', () => {
    const map = new Map([['p1', '2026-02-06T11:00:00Z']]);
    expect(isOnWaivers('p1', 'standard', map)).toBe(true);
    expect(isOnWaivers('p2', 'standard', map)).toBe(false);
    expect(isOnWaivers('p1', 'standard', undefined)).toBe(false);
  });
});

describe('getWaiverBadgeLabel', () => {
  it('returns null in a no-waivers league', () => {
    expect(getWaiverBadgeLabel('p1', 'none', new Map(), 3)).toBeNull();
  });

  it('returns null for standard waivers when the player has no expiry', () => {
    expect(getWaiverBadgeLabel('p1', 'standard', new Map(), 3)).toBeNull();
  });

  it('formats standard waiver expiry day/date', () => {
    const map = new Map([['p1', '2026-02-06T11:00:00Z']]);
    const label = getWaiverBadgeLabel('p1', 'standard', map, 3);
    expect(label).toMatch(/^W · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+$/);
  });

  it('FAAB: shows next processing day (waiverDayOfWeek = 3 = Wednesday)', () => {
    // Now is Wed 2/4. Next Wed (3) is 2/11.
    const label = getWaiverBadgeLabel('p1', 'faab', undefined, 3);
    expect(label).toBe('W · Wed 2/11');
  });

  it('FAAB: shows correct day when waiverDayOfWeek is later in the same week', () => {
    // Now is Wed 2/4. Friday (5) is 2/6.
    const label = getWaiverBadgeLabel('p1', 'faab', undefined, 5);
    expect(label).toBe('W · Fri 2/6');
  });
});

describe('getProcessDate', () => {
  it('returns em-dash for no-waivers league', () => {
    expect(getProcessDate('p1', 'none', new Map(), 3)).toBe('—');
  });

  it('returns em-dash for standard with no player entry', () => {
    expect(getProcessDate('p1', 'standard', new Map(), 3)).toBe('—');
  });

  it('formats a real standard waiver expiry', () => {
    const map = new Map([['p1', '2026-02-06T11:00:00Z']]);
    const result = getProcessDate('p1', 'standard', map, 3);
    expect(result).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+ at /);
  });

  it('FAAB: ends with " at 6:00 AM"', () => {
    expect(getProcessDate('p1', 'faab', undefined, 3)).toContain('at 6:00 AM');
  });
});
