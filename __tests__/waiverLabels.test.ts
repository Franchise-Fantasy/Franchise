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

  it('true iff the player has an on_waivers_until entry (both standard and FAAB)', () => {
    const map = new Map([['p1', '2026-02-06T11:00:00Z']]);
    expect(isOnWaivers('p1', 'standard', map)).toBe(true);
    expect(isOnWaivers('p1', 'faab', map)).toBe(true);
    expect(isOnWaivers('p2', 'standard', map)).toBe(false);
    expect(isOnWaivers('p2', 'faab', map)).toBe(false);
    expect(isOnWaivers('p1', 'standard', undefined)).toBe(false);
    expect(isOnWaivers('p1', 'faab', undefined)).toBe(false);
  });
});

describe('getWaiverBadgeLabel', () => {
  it('returns null in a no-waivers league', () => {
    expect(getWaiverBadgeLabel('p1', 'none', new Map())).toBeNull();
  });

  it('returns null when the player is not on the wire', () => {
    expect(getWaiverBadgeLabel('p1', 'standard', new Map())).toBeNull();
    expect(getWaiverBadgeLabel('p1', 'faab', new Map())).toBeNull();
  });

  it('formats the on-wire expiry day/date (standard and FAAB alike)', () => {
    const map = new Map([['p1', '2026-02-06T11:00:00Z']]);
    expect(getWaiverBadgeLabel('p1', 'standard', map)).toMatch(/^W · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+$/);
    expect(getWaiverBadgeLabel('p1', 'faab', map)).toMatch(/^W · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+$/);
  });
});

describe('getProcessDate', () => {
  it('returns em-dash for no-waivers league', () => {
    expect(getProcessDate('p1', 'none', new Map())).toBe('—');
  });

  it('returns em-dash when the player is not on the wire', () => {
    expect(getProcessDate('p1', 'standard', new Map())).toBe('—');
    expect(getProcessDate('p1', 'faab', new Map())).toBe('—');
  });

  it('formats a real on-wire expiry (standard and FAAB alike)', () => {
    const map = new Map([['p1', '2026-02-06T11:00:00Z']]);
    expect(getProcessDate('p1', 'standard', map)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+ at /);
    expect(getProcessDate('p1', 'faab', map)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+ at /);
  });
});
