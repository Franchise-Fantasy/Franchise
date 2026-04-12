import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useSeasonStandings, TeamSeasonRow } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface StandingsHistoryProps {
  leagueId: string;
}

const RESULT_LABELS: Record<string, string> = {
  champion: 'Champion',
  runner_up: 'Runner-Up',
  missed_playoffs: 'Missed Playoffs',
  playoff_participant: 'Playoffs',
};

function resultLabel(result: string | null): string {
  if (!result) return '—';
  if (RESULT_LABELS[result]) return RESULT_LABELS[result];
  if (result.startsWith('eliminated_round_')) {
    const round = result.replace('eliminated_round_', '');
    return `Elim. Rd ${round}`;
  }
  return result;
}

export function StandingsHistory({ leagueId }: StandingsHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: standings, isLoading } = useSeasonStandings(leagueId);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const seasons = useMemo(() => {
    if (!standings || standings.length === 0) return [];
    const s = new Set(standings.map((r) => r.season));
    return [...s]; // already ordered descending from query
  }, [standings]);

  const activeSeason = selectedSeason ?? seasons[0] ?? null;

  const seasonTeams = useMemo(() => {
    if (!standings || !activeSeason) return [];
    return standings.filter((r) => r.season === activeSeason);
  }, [standings, activeSeason]);

  if (isLoading) return <View style={{ marginVertical: s(16) }}><LogoSpinner /></View>;
  if (seasons.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        Complete a season to build standings history.
      </ThemedText>
    );
  }

  return (
    <View>
      {/* Season pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
        {seasons.map((s) => (
          <TouchableOpacity
            key={s}
            accessibilityRole="button"
            accessibilityLabel={`Season ${s}`}
            accessibilityState={{ selected: activeSeason === s }}
            style={[styles.pill, activeSeason === s ? { backgroundColor: c.accent } : { backgroundColor: c.cardAlt }]}
            onPress={() => setSelectedSeason(s)}
          >
            <ThemedText style={[styles.pillText, activeSeason === s && { color: c.accentText }]}>
              {s}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Standings table */}
      <View style={[styles.table, { borderColor: c.border }]}>
        {/* Header */}
        <View style={[styles.tableHeader, { borderBottomColor: c.border }]}>
          <ThemedText style={[styles.colRank, styles.headerText, { color: c.secondaryText }]}>#</ThemedText>
          <ThemedText style={[styles.colName, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
          <ThemedText style={[styles.colRecord, styles.headerText, { color: c.secondaryText }]}>Record</ThemedText>
          <ThemedText style={[styles.colPF, styles.headerText, { color: c.secondaryText }]}>PF</ThemedText>
          <ThemedText style={[styles.colResult, styles.headerText, { color: c.secondaryText }]}>Result</ThemedText>
        </View>

        {seasonTeams.map((t, idx) => (
          <View
            key={t.id}
            style={[
              styles.tableRow,
              t.playoff_result === 'champion' && { backgroundColor: c.goldMuted },
              idx < seasonTeams.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <ThemedText style={[styles.colRank, { color: c.secondaryText }]}>{t.final_standing}</ThemedText>
            <ThemedText style={styles.colName} numberOfLines={1}>{t.team?.name ?? '—'}</ThemedText>
            <ThemedText style={[styles.colRecord, { color: c.secondaryText }]}>
              {t.wins}-{t.losses}{t.ties > 0 ? `-${t.ties}` : ''}
            </ThemedText>
            <ThemedText style={[styles.colPF, { color: c.secondaryText }]}>{(t.points_for ?? 0).toFixed(1)}</ThemedText>
            <View style={[styles.resultBadge, t.playoff_result === 'champion' && { backgroundColor: c.goldMuted }]}>
              <ThemedText style={[styles.resultText, { color: c.secondaryText }]}>
                {resultLabel(t.playoff_result)}
              </ThemedText>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },
  pillRow: { marginBottom: s(12) },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: s(6),
    borderRadius: 16,
    marginRight: s(8),
  },
  pillText: { fontSize: ms(13), fontWeight: '600' },
  table: { borderRadius: 12, overflow: 'hidden', ...cardShadow },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { fontSize: ms(11), fontWeight: '600' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(10),
  },
  colRank: { width: s(22), fontSize: ms(12), textAlign: 'center' },
  colName: { flex: 1, fontSize: ms(13), marginHorizontal: s(6) },
  colRecord: { width: s(50), fontSize: ms(12), textAlign: 'center' },
  colPF: { width: s(50), fontSize: ms(12), textAlign: 'right' },
  colResult: { width: s(70), fontSize: ms(11), textAlign: 'center' },
  resultBadge: {
    width: s(70),
    paddingHorizontal: s(4),
    paddingVertical: s(2),
    borderRadius: 4,
    alignItems: 'center',
  },
  resultText: { fontSize: ms(10), fontWeight: '600' },
});
