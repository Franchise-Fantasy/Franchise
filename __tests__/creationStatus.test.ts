import { getCreationStatus, WNBA_SEASON_START } from '@/constants/LeagueDefaults';

describe('getCreationStatus', () => {
  it('returns the hardcoded opening night when it is still in the future', () => {
    // Two weeks before WNBA 2026 tipoff (May 15) — opening night still applies.
    const today = new Date(2026, 4, 1); // May 1, 2026
    const status = getCreationStatus('wnba', today);
    expect(status.available).toBe(true);
    expect(status.season).toBe('2026');
    expect(status.defaultStartDate).toBe(WNBA_SEASON_START['2026']);
  });

  it('nulls out the default start date once opening night has passed (mid-season creation)', () => {
    // Past WNBA 2026 tipoff but well before the regular-season end — league
    // is still creatable, but the hardcoded May 15 default no longer applies.
    const today = new Date(2026, 4, 31); // May 31, 2026
    const status = getCreationStatus('wnba', today);
    expect(status.available).toBe(true);
    expect(status.season).toBe('2026');
    expect(status.defaultStartDate).toBeNull();
  });

  it('nulls the default for NBA mid-season creation past opening night', () => {
    // Mid-November after the NBA 2025-26 tipoff (Oct 21).
    const today = new Date(2025, 10, 15); // Nov 15, 2025
    const status = getCreationStatus('nba', today);
    expect(status.available).toBe(true);
    expect(status.season).toBe('2025-26');
    expect(status.defaultStartDate).toBeNull();
  });

  it('returns the next-season default once the current season is too short to be useful', () => {
    // March 2026 — NBA 2025-26 has ~4 weeks left, below the min-10 threshold,
    // so we look at the next-season window. NBA opens for next-season creation
    // July 1, so March still says "not available" with the opens label.
    const today = new Date(2026, 2, 15); // Mar 15, 2026
    const status = getCreationStatus('nba', today);
    expect(status.available).toBe(false);
    expect(status.season).toBe('2026-27');
    expect(status.opensAt).toBeDefined();
  });
});
