import { isTaxiEligible, taxiExperienceLabel } from '@/utils/roster/taxiEligibility';

// ─── isTaxiEligible ─────────────────────────────────────────────────────────

describe('isTaxiEligible', () => {
  it('returns true when maxExperience is null (no max)', () => {
    expect(isTaxiEligible(2020, '2025-26', null)).toBe(true);
  });

  it('returns false when nbaDraftYear is null', () => {
    expect(isTaxiEligible(null, '2025-26', 2)).toBe(false);
  });

  it('returns true for a rookie (drafted current year)', () => {
    // currentYear = 2025 + 1 = 2026, experience = 2026 - 2026 = 0
    expect(isTaxiEligible(2026, '2025-26', 1)).toBe(true);
  });

  it('returns true at exact boundary', () => {
    // currentYear = 2026, experience = 2026 - 2024 = 2
    expect(isTaxiEligible(2024, '2025-26', 2)).toBe(true);
  });

  it('returns false when over boundary', () => {
    // currentYear = 2026, experience = 2026 - 2023 = 3
    expect(isTaxiEligible(2023, '2025-26', 2)).toBe(false);
  });

  it('returns true for maxExperience=1 (rookies only) with first-year player', () => {
    // currentYear = 2026, experience = 2026 - 2025 = 1
    expect(isTaxiEligible(2025, '2025-26', 1)).toBe(true);
  });

  it('returns false for negative experience (future draft year)', () => {
    // currentYear = 2026, experience = 2026 - 2028 = -2
    expect(isTaxiEligible(2028, '2025-26', 2)).toBe(false);
  });
});

// ─── taxiExperienceLabel ────────────────────────────────────────────────────

describe('taxiExperienceLabel', () => {
  it('returns "No Max" for null', () => {
    expect(taxiExperienceLabel(null)).toBe('No Max');
  });

  it('returns "Rookies Only" for 1', () => {
    expect(taxiExperienceLabel(1)).toBe('Rookies Only');
  });

  it('returns "2 Years" for 2', () => {
    expect(taxiExperienceLabel(2)).toBe('2 Years');
  });

  it('returns "3 Years" for 3', () => {
    expect(taxiExperienceLabel(3)).toBe('3 Years');
  });

  it('returns "4 Years" for 4', () => {
    expect(taxiExperienceLabel(4)).toBe('4 Years');
  });
});
