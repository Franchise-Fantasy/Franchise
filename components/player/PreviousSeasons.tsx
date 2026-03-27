import { ThemedText } from "@/components/ThemedText";
import { StyleSheet, View } from "react-native";

interface HistoricalStat {
  season: string;
  games_played: number;
  avg_pts: number;
  avg_reb: number;
  avg_ast: number;
  avg_stl: number;
  avg_blk: number;
}

interface PreviousSeasonsProps {
  historicalStats: HistoricalStat[];
  colors: {
    border: string;
    secondaryText: string;
  };
}

export function PreviousSeasons({
  historicalStats,
  colors: c,
}: PreviousSeasonsProps) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Previous Seasons
      </ThemedText>
      <View
        style={[styles.table, { borderColor: c.border }]}
        accessibilityRole="table"
        accessibilityLabel="Previous season stats"
      >
        <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
          {["Season", "GP", "PPG", "RPG", "APG", "SPG", "BPG"].map((h) => (
            <ThemedText
              key={h}
              style={[
                styles.cell,
                h === "Season" ? styles.cellSeason : styles.cellStat,
                { color: c.secondaryText },
              ]}
            >
              {h}
            </ThemedText>
          ))}
        </View>
        {historicalStats.map((row) => (
          <View
            key={row.season}
            style={[styles.row, { borderBottomColor: c.border }]}
            accessibilityLabel={`${row.season}: ${row.games_played} games, ${row.avg_pts} ppg, ${row.avg_reb} rpg, ${row.avg_ast} apg`}
          >
            <ThemedText style={[styles.cell, styles.cellSeason]} numberOfLines={1}>
              {row.season}
            </ThemedText>
            <ThemedText style={[styles.cell, styles.cellStat]}>
              {row.games_played}
            </ThemedText>
            <ThemedText style={[styles.cell, styles.cellStat]}>
              {Number(row.avg_pts).toFixed(1)}
            </ThemedText>
            <ThemedText style={[styles.cell, styles.cellStat]}>
              {Number(row.avg_reb).toFixed(1)}
            </ThemedText>
            <ThemedText style={[styles.cell, styles.cellStat]}>
              {Number(row.avg_ast).toFixed(1)}
            </ThemedText>
            <ThemedText style={[styles.cell, styles.cellStat]}>
              {Number(row.avg_stl).toFixed(1)}
            </ThemedText>
            <ThemedText style={[styles.cell, styles.cellStat]}>
              {Number(row.avg_blk).toFixed(1)}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  cell: {
    fontSize: 11,
  },
  cellSeason: {
    flex: 2,
    fontWeight: "600",
  },
  cellStat: {
    flex: 1,
    textAlign: "center",
  },
});
