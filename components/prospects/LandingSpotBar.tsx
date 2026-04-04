import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import type { LandingSpot } from '@/types/prospect';
import { StyleSheet, Text, View } from 'react-native';

interface LandingSpotBarProps {
  spot: LandingSpot;
  index: number;
}

export function LandingSpotBar({ spot, index }: LandingSpotBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const pct = parseInt(spot.odds.replace('%', ''), 10) || 0;
  // Scale bar width: max 60% of container width at 100%
  const barWidth = `${Math.min(pct * 0.6, 60)}%`;

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${spot.team}, ${spot.odds} probability`}
    >
      <Text style={[styles.num, { color: c.secondaryText }]}>{index + 1}</Text>
      <View style={styles.info}>
        <Text style={[styles.team, { color: c.text }]} numberOfLines={1}>
          {spot.team}
        </Text>
        <View style={[styles.barTrack, { backgroundColor: c.cardAlt }]}>
          <View style={[styles.barFill, { width: barWidth, backgroundColor: c.accent }]} />
        </View>
      </View>
      <Text style={[styles.odds, { color: c.accent }]}>{spot.odds}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(8),
  },
  num: {
    fontSize: ms(13),
    fontWeight: '700',
    width: s(18),
    textAlign: 'center',
  },
  info: {
    flex: 1,
  },
  team: {
    fontSize: ms(12),
    fontWeight: '600',
    marginBottom: s(3),
  },
  barTrack: {
    height: s(6),
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  odds: {
    fontSize: ms(12),
    fontWeight: '700',
    width: s(36),
    textAlign: 'right',
  },
});
