import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

interface TeamFairness {
  teamName: string;
  netFpts: number;
}

interface TradeFairnessBarProps {
  teams: TeamFairness[];
}

export function TradeFairnessBar({ teams }: TradeFairnessBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const maxAbs = Math.max(...teams.map((t) => Math.abs(t.netFpts)), 1);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.title}>Trade Fairness</ThemedText>
        <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>Avg FPTS +/-</ThemedText>
      </View>
      {teams.map((team) => (
        <FairnessRow
          key={team.teamName}
          team={team}
          maxAbs={maxAbs}
          successColor={c.success}
          dangerColor={c.danger}
        />
      ))}
    </View>
  );
}

// Pulse the bar opacity briefly whenever the team's net swings >5 in
// either direction. Reads as "the deal just tilted" without a flash.
const PULSE_THRESHOLD = 5;

function FairnessRow({
  team,
  maxAbs,
  successColor,
  dangerColor,
}: {
  team: TeamFairness;
  maxAbs: number;
  successColor: string;
  dangerColor: string;
}) {
  const isPositive = team.netFpts >= 0;
  const barWidth = Math.min((Math.abs(team.netFpts) / maxAbs) * 100, 100);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (Math.abs(team.netFpts) > PULSE_THRESHOLD) {
      opacity.value = withSequence(
        withTiming(0.4, { duration: 120 }),
        withTiming(1, { duration: 230 }),
      );
    }
  }, [team.netFpts, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${team.teamName}: ${isPositive ? '+' : ''}${team.netFpts.toFixed(1)} average fantasy points`}
    >
      <ThemedText style={styles.teamName} numberOfLines={1}>{team.teamName}</ThemedText>
      <View style={styles.barContainer}>
        <Animated.View
          style={[
            styles.bar,
            animStyle,
            {
              width: `${barWidth}%`,
              backgroundColor: isPositive ? successColor : dangerColor,
            },
          ]}
        />
      </View>
      <ThemedText
        style={[
          styles.value,
          { color: isPositive ? successColor : dangerColor },
        ]}
      >
        {isPositive ? '+' : ''}{team.netFpts.toFixed(1)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: s(6),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(6),
  },
  title: {
    fontSize: ms(12),
  },
  subtitle: {
    fontSize: ms(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(4),
  },
  teamName: {
    width: s(80),
    fontSize: ms(12),
    fontWeight: '500',
  },
  barContainer: {
    flex: 1,
    height: s(8),
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderRadius: 4,
    marginHorizontal: s(6),
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
  value: {
    width: s(46),
    textAlign: 'right',
    fontSize: ms(12),
    fontWeight: '700',
  },
});
