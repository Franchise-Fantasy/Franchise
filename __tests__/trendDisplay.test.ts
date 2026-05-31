import { TREND_CONFIG } from '@/utils/scoring/trendDisplay';

describe('TREND_CONFIG', () => {
  it('exposes a config for every trend direction', () => {
    expect(Object.keys(TREND_CONFIG).sort()).toEqual(
      ['cold', 'frigid', 'hot', 'neutral', 'scorching'],
    );
  });

  it('every config has a non-empty label, color, and icon', () => {
    for (const cfg of Object.values(TREND_CONFIG)) {
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.color.length).toBeGreaterThan(0);
      expect(cfg.icon.length).toBeGreaterThan(0);
    }
  });

  it('positive and negative trends use distinguishable glyphs (colorblind safety)', () => {
    // The glyph encodes direction independent of color.
    expect(TREND_CONFIG.scorching.icon).toBe('▲▲');
    expect(TREND_CONFIG.hot.icon).toBe('▲');
    expect(TREND_CONFIG.neutral.icon).toBe('—');
    expect(TREND_CONFIG.cold.icon).toBe('▼');
    expect(TREND_CONFIG.frigid.icon).toBe('▼▼');
  });
});
