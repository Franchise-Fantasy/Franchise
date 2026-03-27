import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, View } from 'react-native';

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
      {teams.map((team) => {
        const isPositive = team.netFpts >= 0;
        const barWidth = Math.min((Math.abs(team.netFpts) / maxAbs) * 100, 100);

        return (
          <View key={team.teamName} style={styles.row} accessibilityLabel={`${team.teamName}: ${isPositive ? '+' : ''}${team.netFpts.toFixed(1)} average fantasy points`}>
            <ThemedText style={styles.teamName} numberOfLines={1}>{team.teamName}</ThemedText>
            <View style={styles.barContainer}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${barWidth}%`,
                    backgroundColor: isPositive ? c.success : c.danger,
                  },
                ]}
              />
            </View>
            <ThemedText
              style={[
                styles.value,
                { color: isPositive ? c.success : c.danger },
              ]}
            >
              {isPositive ? '+' : ''}{team.netFpts.toFixed(1)}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 12,
  },
  subtitle: {
    fontSize: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  teamName: {
    width: 80,
    fontSize: 12,
    fontWeight: '500',
  },
  barContainer: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderRadius: 4,
    marginHorizontal: 6,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
  value: {
    width: 46,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
  },
});
