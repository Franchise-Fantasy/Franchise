// utils/dates imports `AppState` from 'react-native' (for the useToday hook).
// We only test the pure helpers, but ts-jest still loads the module, so stub
// react-native before importing.
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
    currentState: 'active',
  },
}));

import { addDays, parseLocalDate, toDateStr } from '@/utils/dates';

describe('toDateStr', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(toDateStr(new Date(2026, 1, 5))).toBe('2026-02-05'); // Feb is month index 1
    expect(toDateStr(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('zero-pads month and day', () => {
    expect(toDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toDateStr(new Date(2026, 8, 9))).toBe('2026-09-09');
  });
});

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD into a local Date (no TZ shift)', () => {
    const d = parseLocalDate('2026-02-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // Feb
    expect(d.getDate()).toBe(15);
  });

  it('round-trips with toDateStr', () => {
    const orig = '2026-07-04';
    expect(toDateStr(parseLocalDate(orig))).toBe(orig);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-02-15', 1)).toBe('2026-02-16');
    expect(addDays('2026-02-15', 14)).toBe('2026-03-01');
  });

  it('subtracts negative days', () => {
    expect(addDays('2026-02-15', -1)).toBe('2026-02-14');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
  });

  it('crosses year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('day 0 is identity', () => {
    expect(addDays('2026-02-15', 0)).toBe('2026-02-15');
  });

  it('handles February leap day correctly', () => {
    // 2024 is a leap year
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });
});
