import { TREND_COLORS } from '@/constants/StatusColors';
import { TrendDirection } from '@/utils/scoring/playerInsights';

/**
 * Display config for a recent-form trend — label, color, and a text glyph.
 * The glyph means the trend reads without relying on color alone (colorblind
 * safety). Shared by PlayerInsights (player-detail modal) and the roster trend
 * board so "Hot" looks identical in both.
 */
export const TREND_CONFIG: Record<
  TrendDirection,
  { label: string; color: string; icon: string }
> = {
  scorching: { label: 'Scorching', color: TREND_COLORS.scorching, icon: '▲▲' },
  hot: { label: 'Hot', color: TREND_COLORS.hot, icon: '▲' },
  neutral: { label: 'Stable', color: TREND_COLORS.neutral, icon: '—' },
  cold: { label: 'Cold', color: TREND_COLORS.cold, icon: '▼' },
  frigid: { label: 'Frigid', color: TREND_COLORS.frigid, icon: '▼▼' },
};
