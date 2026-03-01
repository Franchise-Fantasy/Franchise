import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useHeadToHead, H2HRecord } from '@/hooks/useLeagueHistory';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface HeadToHeadMatrixProps {
  leagueId: string;
}

function formatRecord(r: H2HRecord): string {
  if (r.ties > 0) return `${r.wins}-${r.losses}-${r.ties}`;
  return `${r.wins}-${r.losses}`;
}

function cellColor(r: H2HRecord): string | undefined {
  if (r.wins > r.losses) return '#22c55e18';
  if (r.losses > r.wins) return '#ef444418';
  return undefined;
}

export function HeadToHeadMatrix({ leagueId }: HeadToHeadMatrixProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data, isLoading } = useHeadToHead(leagueId);
  const [selectedPair, setSelectedPair] = useState<{ a: string; b: string } | null>(null);

  const teamNameMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.teams.map((t) => [t.id, t.name]));
  }, [data]);

  // Drill-down matchups for selected pair
  const pairMatchups = useMemo(() => {
    if (!data || !selectedPair) return [];
    return data.matchups
      .filter(
        (m) =>
          (m.home_team_id === selectedPair.a && m.away_team_id === selectedPair.b) ||
          (m.home_team_id === selectedPair.b && m.away_team_id === selectedPair.a),
      )
      .sort((a, b) => {
        if (a.season !== b.season) return a.season.localeCompare(b.season);
        return a.week_number - b.week_number;
      });
  }, [data, selectedPair]);

  // Group drill-down matchups by season
  const pairBySeason = useMemo(() => {
    const map = new Map<string, typeof pairMatchups>();
    for (const m of pairMatchups) {
      if (!map.has(m.season)) map.set(m.season, []);
      map.get(m.season)!.push(m);
    }
    return map;
  }, [pairMatchups]);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 16 }} />;
  if (!data || data.teams.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        Play some matchups to build head-to-head records.
      </ThemedText>
    );
  }

  const CELL_SIZE = 52;
  const NAME_COL_WIDTH = 80;
  const teams = data.teams;

  return (
    <View>
      {/* Matrix */}
      <View style={styles.matrixWrapper}>
        {/* Fixed left column (team tricodes/names) */}
        <View style={[styles.nameCol, { width: NAME_COL_WIDTH }]}>
          <View style={{ height: CELL_SIZE }} />
          {teams.map((t) => (
            <View key={t.id} style={[styles.nameCell, { height: CELL_SIZE }]}>
              <ThemedText style={styles.nameText} numberOfLines={1}>
                {t.tricode ?? t.name.slice(0, 4)}
              </ThemedText>
            </View>
          ))}
        </View>

        {/* Scrollable grid */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Column headers */}
            <View style={styles.headerRow}>
              {teams.map((t) => (
                <View key={t.id} style={[styles.colHeader, { width: CELL_SIZE }]}>
                  <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]} numberOfLines={1}>
                    {t.tricode ?? t.name.slice(0, 4)}
                  </ThemedText>
                </View>
              ))}
            </View>

            {/* Grid rows */}
            {teams.map((rowTeam) => (
              <View key={rowTeam.id} style={styles.gridRow}>
                {teams.map((colTeam) => {
                  if (rowTeam.id === colTeam.id) {
                    return (
                      <View
                        key={colTeam.id}
                        style={[styles.cell, { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: c.cardAlt }]}
                      >
                        <ThemedText style={[styles.cellDash, { color: c.buttonDisabled }]}>—</ThemedText>
                      </View>
                    );
                  }
                  const key = `${rowTeam.id}_${colTeam.id}`;
                  const record = data.records[key];
                  const isSelected = selectedPair?.a === rowTeam.id && selectedPair?.b === colTeam.id;
                  return (
                    <TouchableOpacity
                      key={colTeam.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${teamNameMap.get(rowTeam.id) ?? rowTeam.id} vs ${teamNameMap.get(colTeam.id) ?? colTeam.id}: ${record ? formatRecord(record) : 'no matchups'}`}
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.cell,
                        {
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          backgroundColor: record ? cellColor(record) : undefined,
                        },
                        isSelected && { borderColor: c.accent, borderWidth: 2 },
                      ]}
                      onPress={() => setSelectedPair(record ? { a: rowTeam.id, b: colTeam.id } : null)}
                    >
                      <ThemedText style={styles.cellText}>
                        {record ? formatRecord(record) : '—'}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Drill-down detail */}
      {selectedPair && (
        <View style={[styles.detailContainer, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <View style={styles.detailHeader}>
            <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.detailTitle}>
              {teamNameMap.get(selectedPair.a)} vs {teamNameMap.get(selectedPair.b)}
            </ThemedText>
            {data.records[`${selectedPair.a}_${selectedPair.b}`] && (
              <ThemedText style={[styles.detailRecord, { color: c.accent }]}>
                {formatRecord(data.records[`${selectedPair.a}_${selectedPair.b}`])}
              </ThemedText>
            )}
          </View>

          {[...pairBySeason.entries()].map(([season, matchups]) => (
            <View key={season}>
              <ThemedText style={[styles.seasonLabel, { color: c.secondaryText }]}>{season}</ThemedText>
              {matchups.map((m) => {
                const homeIsA = m.home_team_id === selectedPair.a;
                const aScore = homeIsA ? m.home_score : m.away_score;
                const bScore = homeIsA ? m.away_score : m.home_score;
                const aWon = m.winner_team_id === selectedPair.a;
                const bWon = m.winner_team_id === selectedPair.b;
                return (
                  <View key={m.id} style={styles.matchupRow}>
                    <ThemedText style={[styles.weekLabel, { color: c.secondaryText }]}>
                      Wk {m.week_number}{m.playoff_round ? ' (P)' : ''}
                    </ThemedText>
                    <ThemedText style={[styles.matchupScore, aWon && { color: c.accent, fontWeight: '700' }]}>
                      {aScore.toFixed(1)}
                    </ThemedText>
                    <ThemedText style={[styles.matchupDash, { color: c.secondaryText }]}>–</ThemedText>
                    <ThemedText style={[styles.matchupScore, bWon && { color: c.accent, fontWeight: '700' }]}>
                      {bScore.toFixed(1)}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  matrixWrapper: { flexDirection: 'row' },
  nameCol: {},
  nameCell: { justifyContent: 'center', paddingRight: 6 },
  nameText: { fontSize: 11, fontWeight: '600', textAlign: 'right' },
  headerRow: { flexDirection: 'row', height: 52 },
  colHeader: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 6 },
  colHeaderText: { fontSize: 10, fontWeight: '600' },
  gridRow: { flexDirection: 'row' },
  cell: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
    margin: 1,
  },
  cellText: { fontSize: 11, fontWeight: '600' },
  cellDash: { fontSize: 14 },
  detailContainer: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailTitle: { fontSize: 14, flex: 1 },
  detailRecord: { fontSize: 14, fontWeight: '700' },
  seasonLabel: { fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  weekLabel: { width: 56, fontSize: 12 },
  matchupScore: { fontSize: 13, width: 46, textAlign: 'right' },
  matchupDash: { fontSize: 13 },
});
