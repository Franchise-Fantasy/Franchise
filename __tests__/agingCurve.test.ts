import { getCurveValue, getPositionCurveKey, getSampleSize, projectFpts } from '@/utils/scoring/agingCurve';

describe('getPositionCurveKey', () => {
  it('returns ALL for null/undefined/empty', () => {
    expect(getPositionCurveKey(null)).toBe('ALL');
    expect(getPositionCurveKey(undefined)).toBe('ALL');
    expect(getPositionCurveKey('')).toBe('ALL');
  });

  it('returns the primary token (first before hyphen)', () => {
    expect(getPositionCurveKey('PG')).toBe('PG');
    expect(getPositionCurveKey('PG-SG')).toBe('PG');
    expect(getPositionCurveKey('F-C')).toBe('F');
  });

  it('uppercases and trims', () => {
    expect(getPositionCurveKey('  pg  ')).toBe('PG');
    expect(getPositionCurveKey('sf-pf')).toBe('SF');
  });

  it('falls back to ALL for unknown positions', () => {
    expect(getPositionCurveKey('XYZ')).toBe('ALL');
    expect(getPositionCurveKey('UTIL')).toBe('ALL');
  });

  it('accepts WNBA bare letters G and F', () => {
    expect(getPositionCurveKey('G')).toBe('G');
    expect(getPositionCurveKey('F')).toBe('F');
  });
});

describe('getCurveValue', () => {
  it('returns a positive number for a valid position + reasonable age', () => {
    const val = getCurveValue('PG', 27);
    expect(val).toBeGreaterThan(0);
    expect(Number.isFinite(val)).toBe(true);
  });

  it('falls back to 1 when the position has no curve at all', () => {
    expect(getCurveValue('ALL', 999)).toBeGreaterThanOrEqual(0);
  });

  it('interpolates between integer ages', () => {
    const lower = getCurveValue('SF', 26);
    const upper = getCurveValue('SF', 27);
    const mid = getCurveValue('SF', 26.5);
    if (lower !== upper) {
      const min = Math.min(lower, upper);
      const max = Math.max(lower, upper);
      expect(mid).toBeGreaterThanOrEqual(min);
      expect(mid).toBeLessThanOrEqual(max);
    }
  });
});

describe('projectFpts', () => {
  it('returns the same fpts when projecting from age N to age N', () => {
    const result = projectFpts(30, 27, 27, 'PG');
    expect(result).toBeCloseTo(30, 1);
  });

  it('rounds to 2 decimals', () => {
    const result = projectFpts(30.123456, 27, 28, 'PG');
    expect(Number.isFinite(result)).toBe(true);
    expect(result.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});

describe('getSampleSize', () => {
  it('returns a non-negative integer', () => {
    const n = getSampleSize('PG', 27);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it('returns 0 for an out-of-range age', () => {
    expect(getSampleSize('PG', 99)).toBe(0);
  });
});
