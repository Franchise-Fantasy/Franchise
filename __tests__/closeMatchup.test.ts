import {
  CATEGORY_GAP_MAX,
  CATEGORY_MIN_DECIDED,
  POINTS_FLAT_THRESHOLD,
  POINTS_PERCENT_THRESHOLD,
  categoriesClose,
  pointsClose,
} from '@/utils/liveActivity/closeMatchup';

describe('liveActivity/closeMatchup', () => {
  describe('pointsClose', () => {
    it(`triggers within the flat threshold (${POINTS_FLAT_THRESHOLD} fpts)`, () => {
      expect(pointsClose(800, 770)).toBe(true);
      expect(pointsClose(770, 800)).toBe(true);
      expect(pointsClose(100, 100)).toBe(true);
    });

    it('triggers when the gap is within the relative threshold even if absolute > flat', () => {
      // 1200 vs 1050: gap=150, leader=1200 → 0.125 ≤ 0.15 → close
      expect(pointsClose(1200, 1050)).toBe(true);
    });

    it('does not trigger when gap exceeds BOTH absolute and relative thresholds', () => {
      // 500 vs 450: gap=50 > 30 (flat); 50/500 = 0.10 ≤ 0.15 → still close by %
      // Move further apart: 500 vs 400 → 100/500 = 0.20 → not close
      expect(pointsClose(500, 400)).toBe(false);
    });

    it(`treats leader=0 safely (no NaN)`, () => {
      expect(pointsClose(0, 0)).toBe(true);
      expect(pointsClose(0, 0.5)).toBe(true);
    });

    it('honors the documented percentage threshold', () => {
      expect(POINTS_PERCENT_THRESHOLD).toBe(0.15);
    });
  });

  describe('categoriesClose', () => {
    it(`requires at least ${CATEGORY_MIN_DECIDED} decided categories`, () => {
      // 1-1-0 = 2 decided; below floor even though tied
      expect(categoriesClose(1, 1, 0)).toBe(false);
      // 2-1-0 = 3 decided; gap of 1 → close
      expect(categoriesClose(2, 1, 0)).toBe(true);
    });

    it(`considers tied/1-cat-apart matchups close once enough decided`, () => {
      expect(categoriesClose(3, 3, 0)).toBe(true);
      expect(categoriesClose(4, 3, 0)).toBe(true);
      expect(categoriesClose(3, 4, 0)).toBe(true);
      expect(categoriesClose(5, 3, 1)).toBe(false); // 2 apart
    });

    it(`honors the documented gap maximum`, () => {
      expect(CATEGORY_GAP_MAX).toBe(1);
    });

    it('counts ties toward the decided floor', () => {
      // 1-1-1 = 3 decided; gap of 0 → close
      expect(categoriesClose(1, 1, 1)).toBe(true);
    });
  });
});
