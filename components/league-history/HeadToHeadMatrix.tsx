import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { H2HRecord, useHeadToHead } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';


interface HeadToHeadMatrixProps {
  leagueId: string;
}

function formatRecord(r: H2HRecord): string {
  if (r.ties > 0) return `${r.wins}-${r.losses}-${r.ties}`;
  return `${r.wins}-${r.losses}`;
}

export function HeadToHeadMatrix({ leagueId }: HeadToHeadMatrixProps) {
  const c = useColors();
  const { data, isLoading } = useHeadToHead(leagueId);
  const [selectedPair, setSelectedPair] = useState<{ a: string; b: string } | null>(null);

  const teamNameMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.teams.map((t) => [t.id, t.name]));
  }, [data]);

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

  const pairBySeason = useMemo(() => {
    const map = new Map<string, typeof pairMatchups>();
    for (const m of pairMatchups) {
      if (!map.has(m.season)) map.set(m.season, []);
      map.get(m.season)!.push(m);
    }
    return map;
  }, [pairMatchups]);

  if (isLoading) return <View style={styles.loading}><LogoSpinner /></View>;
  if (!data || data.teams.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        Play some matchups to build head-to-head records.
      </ThemedText>
    );
  }

  const CELL_SIZE = s(48);
  const CELL_GAP = s(3);
  const HEADER_HEIGHT = s(28);
  const NAME_COL_WIDTH = s(44);
  const teams = data.teams;

  return (
    <View>
      {/* Two-column layout: the left tricode column is PINNED (not part
          of the horizontal scroll) so row context never gets lost when
          scanning across a large league's matrix. The right portion
          (column headers + data cells) is the only thing that scrolls.
          Inside the scroll view, flexGrow + justifyContent: 'center'
          keeps small leagues centered instead of flush-left. */}
      <View style={styles.matrixWrap}>
        {/* Pinned left column */}
        <View style={{ width: NAME_COL_WIDTH }}>
          <View style={{ height: HEADER_HEIGHT }} />
          {teams.map((rowTeam) => (
            <View
              key={rowTeam.id}
              style={[styles.nameCell, { height: CELL_SIZE, marginTop: CELL_GAP }]}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.nameText, { color: c.secondaryText }]}
                numberOfLines={1}
              >
                {rowTeam.tricode ?? rowTeam.name.slice(0, 4)}
              </ThemedText>
            </View>
          ))}
        </View>

        {/* Scrolling right portion */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={styles.matrixScrollContent}
        >
          <View>
            <View style={[styles.headerRow, { height: HEADER_HEIGHT }]}>
              {teams.map((t, i) => (
                <View
                  key={t.id}
                  style={[
                    styles.colHeader,
                    { width: CELL_SIZE, marginLeft: i === 0 ? 0 : CELL_GAP },
                  ]}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.colHeaderText, { color: c.secondaryText }]}
                    numberOfLines={1}
                  >
                    {t.tricode ?? t.name.slice(0, 4)}
                  </ThemedText>
                </View>
              ))}
            </View>

            {teams.map((rowTeam) => (
              <View key={rowTeam.id} style={[styles.gridRow, { marginTop: CELL_GAP }]}>
                {teams.map((colTeam, i) => {
                  if (rowTeam.id === colTeam.id) {
                    return (
                      <View
                        key={colTeam.id}
                        style={[
                          styles.cell,
                          styles.cellDiagonal,
                          {
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            marginLeft: i === 0 ? 0 : CELL_GAP,
                            backgroundColor: c.cardAlt,
                            borderColor: c.border,
                          },
                        ]}
                      >
                        <ThemedText style={[styles.cellDash, { color: c.buttonDisabled }]}>
                          —
                        </ThemedText>
                      </View>
                    );
                  }
                  const key = `${rowTeam.id}_${colTeam.id}`;
                  const record = data.records[key];
                  const isSelected =
                    selectedPair?.a === rowTeam.id && selectedPair?.b === colTeam.id;
                  const winning = record && record.wins > record.losses;
                  const losing = record && record.losses > record.wins;
                  return (
                    <TouchableOpacity
                      key={colTeam.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${teamNameMap.get(rowTeam.id) ?? rowTeam.id} vs ${teamNameMap.get(colTeam.id) ?? colTeam.id}: ${record ? formatRecord(record) : 'no matchups'}`}
                      accessibilityState={{ selected: isSelected }}
                      activeOpacity={0.7}
                      style={[
                        styles.cell,
                        {
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          marginLeft: i === 0 ? 0 : CELL_GAP,
                          borderColor: c.border,
                          backgroundColor: winning
                            ? c.successMuted
                            : losing
                              ? c.dangerMuted
                              : 'transparent',
                        },
                        isSelected && { borderColor: c.primary, borderWidth: 2 },
                      ]}
                      onPress={() =>
                        setSelectedPair(record ? { a: rowTeam.id, b: colTeam.id } : null)
                      }
                    >
                      <ThemedText
                        type="mono"
                        style={[
                          styles.cellText,
                          {
                            color: winning ? c.success : losing ? c.danger : c.secondaryText,
                          },
                        ]}
                      >
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

      {/* Drill-down detail — a muted inset card inside the parent card. */}
      {selectedPair && (
        <View
          style={[
            styles.detailCard,
            { backgroundColor: c.cardAlt, borderColor: c.border },
          ]}
        >
          <View style={styles.detailHeader}>
            <ThemedText
              type="sectionLabel"
              style={[styles.detailTitle, { color: c.text }]}
              numberOfLines={2}
            >
              {teamNameMap.get(selectedPair.a)} vs {teamNameMap.get(selectedPair.b)}
            </ThemedText>
            {data.records[`${selectedPair.a}_${selectedPair.b}`] && (
              <ThemedText
                type="mono"
                style={[styles.detailRecord, { color: c.text }]}
              >
                {formatRecord(data.records[`${selectedPair.a}_${selectedPair.b}`])}
              </ThemedText>
            )}
          </View>

          {[...pairBySeason.entries()].map(([season, matchups]) => (
            <View key={season} style={styles.seasonBlock}>
              <ThemedText
                type="varsitySmall"
                style={[styles.seasonLabel, { color: c.secondaryText }]}
              >
                {season}
              </ThemedText>
              {matchups.map((m) => {
                const homeIsA = m.home_team_id === selectedPair.a;
                const aScore = homeIsA ? m.home_score : m.away_score;
                const bScore = homeIsA ? m.away_score : m.home_score;
                const aWon = m.winner_team_id === selectedPair.a;
                const bWon = m.winner_team_id === selectedPair.b;
                return (
                  <View key={m.id} style={styles.matchupRow}>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.weekLabel, { color: c.secondaryText }]}
                    >
                      Wk {m.week_number}
                      {m.playoff_round ? ' · Playoff' : ''}
                    </ThemedText>
                    <ThemedText
                      type="mono"
                      style={[
                        styles.matchupScore,
                        aWon && { color: c.success, fontWeight: '700' },
                        !aWon && { color: c.secondaryText },
                      ]}
                    >
                      {aScore.toFixed(1)}
                    </ThemedText>
                    <ThemedText style={[styles.matchupDash, { color: c.secondaryText }]}>
                      –
                    </ThemedText>
                    <ThemedText
                      type="mono"
                      style={[
                        styles.matchupScore,
                        bWon && { color: c.success, fontWeight: '700' },
                        !bWon && { color: c.secondaryText },
                      ]}
                    >
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
  emptyText: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },
  loading: { paddingVertical: s(24) },
  // Two-column layout: pinned tricode column + horizontally-scrolling
  // data grid. paddingVertical breathes above/below the header.
  matrixWrap: {
    flexDirection: 'row',
    paddingVertical: s(4),
  },
  // flexGrow: 1 + justifyContent: 'center' → the data grid centers
  // within the scroll view when its total width is narrower than the
  // viewport (small leagues). When it overflows (large leagues), the
  // scrollview engages and the pinned left column keeps row context
  // visible the whole time.
  matrixScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingLeft: s(6),
    paddingRight: s(4),
  },
  nameCell: {
    justifyContent: 'center',
    paddingRight: s(8),
  },
  nameText: {
    fontSize: ms(10),
    textAlign: 'right',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: s(4),
  },
  colHeader: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  colHeaderText: {
    fontSize: ms(9.5),
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
  },
  cellDiagonal: {
    opacity: 0.5,
  },
  cellText: { fontSize: ms(11) },
  cellDash: { fontSize: ms(14) },
  detailCard: {
    marginTop: s(16),
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(8),
  },
  detailTitle: { flex: 1, fontSize: ms(14) },
  detailRecord: { fontSize: ms(13) },
  seasonBlock: {
    marginTop: s(6),
  },
  seasonLabel: {
    fontSize: ms(9.5),
    marginTop: s(6),
    marginBottom: s(4),
  },
  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(4),
    gap: s(8),
  },
  weekLabel: { width: s(70), fontSize: ms(9.5) },
  matchupScore: { fontSize: ms(12), width: s(46), textAlign: 'right' },
  matchupDash: { fontSize: ms(12) },
});
