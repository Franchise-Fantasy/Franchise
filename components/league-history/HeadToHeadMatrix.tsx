import { ThemedText } from "@/components/ui/ThemedText";
import { Colors, cardShadow } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { H2HRecord, useHeadToHead } from "@/hooks/useLeagueHistory";
import { ms, s } from '@/utils/scale';
import { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { LogoSpinner } from "@/components/ui/LogoSpinner";

interface HeadToHeadMatrixProps {
  leagueId: string;
}

function formatRecord(r: H2HRecord): string {
  if (r.ties > 0) return `${r.wins}-${r.losses}-${r.ties}`;
  return `${r.wins}-${r.losses}`;
}

function cellColor(r: H2HRecord, c: typeof Colors.light): string | undefined {
  if (r.wins > r.losses) return c.success + "18";
  if (r.losses > r.wins) return c.danger + "18";
  return undefined;
}

export function HeadToHeadMatrix({ leagueId }: HeadToHeadMatrixProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { data, isLoading } = useHeadToHead(leagueId);
  const [selectedPair, setSelectedPair] = useState<{
    a: string;
    b: string;
  } | null>(null);

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
          (m.home_team_id === selectedPair.a &&
            m.away_team_id === selectedPair.b) ||
          (m.home_team_id === selectedPair.b &&
            m.away_team_id === selectedPair.a),
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

  if (isLoading) return <View style={{ marginVertical: 16 }}><LogoSpinner /></View>;
  if (!data || data.teams.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        Play some matchups to build head-to-head records.
      </ThemedText>
    );
  }

  const CELL_SIZE = s(52);
  const NAME_COL_WIDTH = s(40);
  const teams = data.teams;

  return (
    <View>
      {/* Matrix */}
      <View style={styles.matrixWrapper}>
        {/* Fixed left column (team tricodes/names) */}
        <View style={[styles.nameCol, { width: NAME_COL_WIDTH }]}>
          <View style={{ height: CELL_SIZE + 2 }} />
          {teams.map((t) => (
            <View key={t.id} style={[styles.nameCell, { height: CELL_SIZE + 2 }]}>
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
                <View
                  key={t.id}
                  style={[styles.colHeader, { width: CELL_SIZE }]}
                >
                  <ThemedText
                    style={[styles.colHeaderText, { color: c.secondaryText }]}
                    numberOfLines={1}
                  >
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
                        style={[
                          styles.cell,
                          {
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            backgroundColor: c.cardAlt,
                          },
                        ]}
                      >
                        <ThemedText
                          style={[styles.cellDash, { color: c.buttonDisabled }]}
                        >
                          —
                        </ThemedText>
                      </View>
                    );
                  }
                  const key = `${rowTeam.id}_${colTeam.id}`;
                  const record = data.records[key];
                  const isSelected =
                    selectedPair?.a === rowTeam.id &&
                    selectedPair?.b === colTeam.id;
                  return (
                    <TouchableOpacity
                      key={colTeam.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${teamNameMap.get(rowTeam.id) ?? rowTeam.id} vs ${teamNameMap.get(colTeam.id) ?? colTeam.id}: ${record ? formatRecord(record) : "no matchups"}`}
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.cell,
                        {
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          backgroundColor: record
                            ? cellColor(record, c)
                            : undefined,
                        },
                        isSelected && { borderColor: c.accent, borderWidth: 2 },
                      ]}
                      onPress={() =>
                        setSelectedPair(
                          record ? { a: rowTeam.id, b: colTeam.id } : null,
                        )
                      }
                    >
                      <ThemedText style={styles.cellText}>
                        {record ? formatRecord(record) : "—"}
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
        <View
          style={[
            styles.detailContainer,
            { backgroundColor: c.cardAlt, borderColor: c.border },
          ]}
        >
          <View style={styles.detailHeader}>
            <ThemedText
              accessibilityRole="header"
              type="defaultSemiBold"
              style={styles.detailTitle}
            >
              {teamNameMap.get(selectedPair.a)} vs{" "}
              {teamNameMap.get(selectedPair.b)}
            </ThemedText>
            {data.records[`${selectedPair.a}_${selectedPair.b}`] && (
              <ThemedText style={[styles.detailRecord, { color: c.accent }]}>
                {formatRecord(
                  data.records[`${selectedPair.a}_${selectedPair.b}`],
                )}
              </ThemedText>
            )}
          </View>

          {[...pairBySeason.entries()].map(([season, matchups]) => (
            <View key={season}>
              <ThemedText
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
                      style={[styles.weekLabel, { color: c.secondaryText }]}
                    >
                      Wk {m.week_number}
                      {m.playoff_round ? " (P)" : ""}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.matchupScore,
                        aWon && { color: c.accent, fontWeight: "700" },
                      ]}
                    >
                      {aScore.toFixed(1)}
                    </ThemedText>
                    <ThemedText
                      style={[styles.matchupDash, { color: c.secondaryText }]}
                    >
                      –
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.matchupScore,
                        bWon && { color: c.accent, fontWeight: "700" },
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
  emptyText: { fontSize: ms(13), textAlign: "center", paddingVertical: s(16) },
  matrixWrapper: { flexDirection: "row", marginLeft: s(-10) },
  nameCol: {},
  nameCell: { justifyContent: "center", paddingRight: s(8) },
  nameText: { fontSize: ms(11), fontWeight: "600", textAlign: "right" },
  headerRow: { flexDirection: "row", height: s(52) },
  colHeader: {
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: s(6),
  },
  colHeaderText: { fontSize: ms(10), fontWeight: "600" },
  gridRow: { flexDirection: "row" },
  cell: {
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 4,
    margin: 1,
  },
  cellText: { fontSize: ms(11), fontWeight: "600" },
  cellDash: { fontSize: ms(14) },
  detailContainer: {
    marginTop: s(16),
    borderRadius: 12,
    borderWidth: 1,
    padding: s(14),
    ...cardShadow,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(10),
  },
  detailTitle: { fontSize: ms(14), flex: 1 },
  detailRecord: { fontSize: ms(14), fontWeight: "700" },
  seasonLabel: {
    fontSize: ms(12),
    fontWeight: "600",
    marginTop: s(8),
    marginBottom: s(4),
  },
  matchupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(4),
    gap: s(8),
  },
  weekLabel: { width: s(56), fontSize: ms(12) },
  matchupScore: { fontSize: ms(13), width: s(46), textAlign: "right" },
  matchupDash: { fontSize: ms(13) },
});
