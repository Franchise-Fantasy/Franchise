import { startDateBelongsToSeason } from '@/constants/LeagueDefaults';

describe('startDateBelongsToSeason', () => {
  it('treats a missing date as not belonging', () => {
    expect(startDateBelongsToSeason('2025-26', null)).toBe(false);
    expect(startDateBelongsToSeason('2025-26', undefined)).toBe(false);
  });

  it('accepts dates within an NBA two-calendar-year season', () => {
    // "2025-26" spans Oct 2025 → Apr 2026
    expect(startDateBelongsToSeason('2025-26', '2025-10-21')).toBe(true);
    expect(startDateBelongsToSeason('2025-26', '2026-01-15')).toBe(true);
  });

  it('rejects the prior season carried over after advancing', () => {
    // After advance-season the season is "2025-26" but the stored date is
    // still last season's October start.
    expect(startDateBelongsToSeason('2025-26', '2024-10-22')).toBe(false);
  });

  it('handles single-year WNBA seasons', () => {
    expect(startDateBelongsToSeason('2026', '2026-05-16')).toBe(true);
    expect(startDateBelongsToSeason('2026', '2025-05-17')).toBe(false);
  });
});
