import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export interface ScoringSummaryStat {
  stat_name: string;
  /** Points leagues — the per-stat point value (may be negative). */
  point_value?: number;
  /** Category leagues — true when lower is better (e.g. turnovers). */
  inverse?: boolean;
}

interface ScoringSummaryProps {
  stats: ScoringSummaryStat[];
  mode: 'points' | 'categories';
}

/**
 * Human-readable scoring recap rendered as a wrapping chip grid — one chip
 * per stat (name + signed point value for points leagues, name + ▾ marker
 * for inverse categories). Replaces the old pipe-delimited text wall. Shared
 * by the create-league Review step and the league-info Scoring card so the
 * two read identically. Mirrors the StepScoring category-chip aesthetic.
 */
export function ScoringSummary({ stats, mode }: ScoringSummaryProps) {
  const c = useColors();

  if (stats.length === 0) {
    return <ThemedText style={[styles.empty, { color: c.secondaryText }]}>—</ThemedText>;
  }

  return (
    <View style={styles.grid} accessibilityLabel={`${stats.length} scoring ${mode === 'points' ? 'stats' : 'categories'}`}>
      {stats.map((stat) => {
        const value =
          mode === 'points' && stat.point_value != null
            ? `${stat.point_value > 0 ? '+' : ''}${stat.point_value}`
            : null;
        const isPenalty = (stat.point_value ?? 0) < 0;
        return (
          <View
            key={stat.stat_name}
            style={[styles.chip, { backgroundColor: c.cardAlt, borderColor: c.border }]}
          >
            <ThemedText style={[styles.statName, { color: c.text }]}>{stat.stat_name}</ThemedText>
            {value != null && (
              <ThemedText style={[styles.statValue, { color: isPenalty ? c.danger : c.accent }]}>
                {value}
              </ThemedText>
            )}
            {mode === 'categories' && stat.inverse && (
              <ThemedText style={[styles.statValue, { color: c.secondaryText }]}>▾</ThemedText>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
    paddingVertical: s(2),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: s(5),
    paddingHorizontal: s(9),
  },
  statName: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '700',
  },
  empty: {
    fontSize: ms(13),
  },
});
