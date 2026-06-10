// utils/dates imports `AppState` from 'react-native' (for the useToday hook).
// We only test the pure helpers, but ts-jest still loads the module, so stub
// react-native before importing.
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
    currentState: 'active',
  },
}));

import { addDays, defaultLeagueDay, formatDateTimeWithZone, formatShortDate, parseLocalDate, toDateStr } from '@/utils/dates';

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

describe('defaultLeagueDay', () => {
  it('returns opening night when the season starts in the future', () => {
    // A not-yet-started league should open on its first day, not today.
    expect(defaultLeagueDay('2026-06-07', '2026-06-08')).toBe('2026-06-08');
    expect(defaultLeagueDay('2026-06-07', '2026-10-20')).toBe('2026-10-20');
  });

  it('returns today when the season is already under way', () => {
    expect(defaultLeagueDay('2026-06-10', '2026-06-08')).toBe('2026-06-10');
  });

  it('returns today when today equals opening night', () => {
    expect(defaultLeagueDay('2026-06-08', '2026-06-08')).toBe('2026-06-08');
  });

  it('falls back to today when there is no schedule yet', () => {
    expect(defaultLeagueDay('2026-06-07', null)).toBe('2026-06-07');
    expect(defaultLeagueDay('2026-06-07', undefined)).toBe('2026-06-07');
  });
});

describe('formatShortDate', () => {
  it('formats YYYY-MM-DD as a compact "Mon D" label without weekday', () => {
    expect(formatShortDate('2026-06-06')).toBe('Jun 6');
    expect(formatShortDate('2026-01-01')).toBe('Jan 1');
    expect(formatShortDate('2026-12-31')).toBe('Dec 31');
  });
});

describe('formatDateTimeWithZone', () => {
  const d = new Date('2026-06-08T20:00:00Z');

  // The same label WITHOUT the zone token, computed locally so the assertions
  // hold regardless of the host machine's timezone (CI may be UTC, a dev box PT).
  const noZone = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

  it('renders a wall-clock time', () => {
    expect(formatDateTimeWithZone(d)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('appends an explicit timezone label so the string is unambiguous across zones', () => {
    const withZone = formatDateTimeWithZone(d);
    // The zoned label is the plain label plus a trailing zone token (e.g.
    // " EDT" or " GMT-4"), so it starts with the plain label and is longer.
    expect(withZone.startsWith(noZone)).toBe(true);
    expect(withZone.length).toBeGreaterThan(noZone.length);
  });
});
