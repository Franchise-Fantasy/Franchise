import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { CategoryResult } from '@/utils/categoryScoring';
import { StyleSheet, View } from 'react-native';

interface CategoryScoreboardProps {
  results: CategoryResult[];
  homeWins: number;
  awayWins: number;
  ties: number;
  homeTeamName: string;
  awayTeamName: string;
}

const WIN_COLOR = '#34C759';
const LOSS_COLOR = '#FF3B30';
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
      {results.map((cat) => {
        const rowColor = cat.winner === 'home'
          ? WIN_COLOR
          : cat.winner === 'away'
            ? LOSS_COLOR
            : TIE_COLOR;

        const resultLabel = cat.winner === 'home' ? 'W' : cat.winner === 'away' ? 'L' : 'T';

        return (
          <View
            key={cat.stat}
            style={[styles.row, { borderBottomColor: c.border }]}
            accessibilityLabel={`${cat.stat}: ${homeTeamName} ${cat.home}, ${awayTeamName} ${cat.away}, ${resultLabel === 'W' ? 'win' : resultLabel === 'L' ? 'loss' : 'tie'}`}
          >
            <ThemedText style={[styles.statCol, styles.statLabel]}>{cat.stat}</ThemedText>
            <ThemedText style={[styles.valueCol, styles.valueText, cat.winner === 'home' && { color: WIN_COLOR, fontWeight: '700' }]}>
              {formatStatValue(cat.stat, cat.home)}
            </ThemedText>
            <ThemedText style={[styles.vsCol, { color: c.secondaryText }]}>
              {cat.winner === 'home' ? '>' : cat.winner === 'away' ? '<' : '='}
            </ThemedText>
            <ThemedText style={[styles.valueCol, styles.valueText, cat.winner === 'away' && { color: LOSS_COLOR, fontWeight: '700' }]}>
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
    paddingVertical: 8,
  },
  record: {
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
  headerRow: {
    borderBottomWidth: 1,
    paddingBottom: 6,
    marginBottom: 2,
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statCol: {
    width: 34,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  valueCol: {
    flex: 1,
    textAlign: 'center',
  },
  valueText: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  vsCol: {
    width: 20,
    textAlign: 'center',
    fontSize: 13,
  },
  resultCol: {
    width: 34,
    textAlign: 'center',
    fontSize: 14,
  },
});
