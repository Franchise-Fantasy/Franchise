import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { CategoryResult } from '@/utils/categoryScoring';
import { ms, s } from '@/utils/scale';
import { StyleSheet, View } from 'react-native';

interface CategoryScoreboardProps {
  results: CategoryResult[];
  homeWins: number;
  awayWins: number;
  ties: number;
  homeTeamName: string;
  awayTeamName: string;
}

const TIE_COLOR = '#8E8E93';

function formatStatValue(stat: string, value: number): string {
  if (stat === 'FG%' || stat === 'FT%') {
    return value === 0 ? '.000' : `.${(value * 1000).toFixed(0).padStart(3, '0')}`;
  }
  return String(Math.round(value));
}

export function CategoryScoreboard({
  results,
  homeWins,
  awayWins,
  ties,
  homeTeamName,
  awayTeamName,
}: CategoryScoreboardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const recordStr = ties > 0
    ? `${homeWins} - ${awayWins} - ${ties}`
    : `${homeWins} - ${awayWins}`;

  return (
    <View
      style={styles.container}
      accessibilityLabel={`Category matchup: ${homeTeamName} ${homeWins}, ${awayTeamName} ${awayWins}${ties > 0 ? `, ${ties} ties` : ''}`}
    >
      {/* Record header */}
      <ThemedText type="title" style={styles.record}>
        {recordStr}
      </ThemedText>

      {/* Column headers */}
      <View style={[styles.row, styles.headerRow, { borderBottomColor: c.border }]}>
        <ThemedText style={[styles.statCol, styles.headerText, { color: c.secondaryText }]}>CAT</ThemedText>
        <ThemedText style={[styles.valueCol, styles.headerText, { color: c.secondaryText }]}>{homeTeamName.slice(0, 8)}</ThemedText>
        <ThemedText style={[styles.vsCol, styles.headerText, { color: c.secondaryText }]}> </ThemedText>
        <ThemedText style={[styles.valueCol, styles.headerText, { color: c.secondaryText }]}>{awayTeamName.slice(0, 8)}</ThemedText>
        <ThemedText style={[styles.resultCol, styles.headerText, { color: c.secondaryText }]}> </ThemedText>
      </View>

      {/* Category rows */}
      {results.map((cat, idx) => {
        const rowColor = cat.winner === 'home'
          ? c.success
          : cat.winner === 'away'
            ? c.danger
            : TIE_COLOR;

        const resultLabel = cat.winner === 'home' ? 'W' : cat.winner === 'away' ? 'L' : 'T';

        return (
          <View
            key={cat.stat}
            style={[styles.row, { borderBottomColor: c.border }, idx === results.length - 1 && { borderBottomWidth: 0 }]}
            accessibilityLabel={`${cat.stat}: ${homeTeamName} ${cat.home}, ${awayTeamName} ${cat.away}, ${resultLabel === 'W' ? 'win' : resultLabel === 'L' ? 'loss' : 'tie'}`}
          >
            <ThemedText style={[styles.statCol, styles.statLabel]}>{cat.stat}</ThemedText>
            <ThemedText style={[styles.valueCol, styles.valueText, cat.winner === 'home' && { color: c.success, fontWeight: '700' }]}>
              {formatStatValue(cat.stat, cat.home)}
            </ThemedText>
            <ThemedText style={[styles.vsCol, { color: c.secondaryText }]}>
              {cat.winner === 'home' ? '>' : cat.winner === 'away' ? '<' : '='}
            </ThemedText>
            <ThemedText style={[styles.valueCol, styles.valueText, cat.winner === 'away' && { color: c.danger, fontWeight: '700' }]}>
              {formatStatValue(cat.stat, cat.away)}
            </ThemedText>
            <ThemedText style={[styles.resultCol, { color: rowColor, fontWeight: '700' }]}>
              {resultLabel}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: s(8),
  },
  record: {
    textAlign: 'center',
    fontSize: ms(28),
    fontWeight: '800',
    marginBottom: s(12),
  },
  headerRow: {
    borderBottomWidth: 1,
    paddingBottom: s(6),
    marginBottom: s(2),
  },
  headerText: {
    fontSize: ms(11),
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statCol: {
    width: s(34),
  },
  statLabel: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  valueCol: {
    flex: 1,
    textAlign: 'center',
  },
  valueText: {
    fontSize: ms(15),
    fontVariant: ['tabular-nums'],
  },
  vsCol: {
    width: s(20),
    textAlign: 'center',
    fontSize: ms(13),
  },
  resultCol: {
    width: s(34),
    textAlign: 'center',
    fontSize: ms(14),
  },
});
