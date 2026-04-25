import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { cardShadow } from "@/constants/Colors";
import { PlayerSeasonStats } from "@/types/player";
import { ms, s } from "@/utils/scale";

interface SeasonAveragesProps {
  player: PlayerSeasonStats;
  avgFpts: number | null;
  isCategories: boolean;
  rankings: {
    overallRank: number;
    positionRank: number;
    primaryPosition: string;
  } | null;
  colors: {
    secondaryText: string;
    accent: string;
    card: string;
    statusText: string;
  };
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.statBox} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText style={[styles.statLabel, { color }]}>{label}</ThemedText>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
    </View>
  );
}

export function SeasonAverages({
  player,
  avgFpts,
  isCategories,
  rankings,
  colors: c,
}: SeasonAveragesProps) {
  const fgPct =
    player.avg_fga > 0
      ? ((player.avg_fgm / player.avg_fga) * 100).toFixed(1)
      : "0.0";
  const threePct =
    player.avg_3pa > 0
      ? ((player.avg_3pm / player.avg_3pa) * 100).toFixed(1)
      : "0.0";
  const ftPct =
    player.avg_fta > 0
      ? ((player.avg_ftm / player.avg_fta) * 100).toFixed(1)
      : "0.0";

  return (
    <View style={styles.section}>
      <View style={styles.badgeRow}>
        {rankings && !isCategories && (
          <View style={styles.rankGroup}>
            <View
              style={[styles.rankBadge, { backgroundColor: c.accent }]}
              accessibilityLabel={`Ranked number ${rankings.overallRank} overall`}
            >
              <ThemedText
                style={[styles.rankBadgeText, { color: c.statusText }]}
              >
                #{rankings.overallRank} Overall
              </ThemedText>
            </View>
            <View
              style={[
                styles.rankBadge,
                { backgroundColor: c.accent, opacity: 0.85 },
              ]}
              accessibilityLabel={`Ranked number ${rankings.positionRank} among ${rankings.primaryPosition}`}
            >
              <ThemedText
                style={[styles.rankBadgeText, { color: c.statusText }]}
              >
                #{rankings.positionRank} {rankings.primaryPosition}
              </ThemedText>
            </View>
          </View>
        )}
        {avgFpts !== null && !isCategories && (
          <ThemedText style={[styles.fptsInline, { color: c.accent }]}>
            {Math.round(avgFpts * 10) / 10} FPTS
          </ThemedText>
        )}
      </View>
      <View style={[styles.statsGrid, { backgroundColor: c.card }]}>
        <StatBox label="PPG" value={String(player.avg_pts)} color={c.secondaryText} />
        <StatBox label="RPG" value={String(player.avg_reb)} color={c.secondaryText} />
        <StatBox label="APG" value={String(player.avg_ast)} color={c.secondaryText} />
        <StatBox label="SPG" value={String(player.avg_stl)} color={c.secondaryText} />
        <StatBox label="BPG" value={String(player.avg_blk)} color={c.secondaryText} />
        <StatBox label="TPG" value={String(player.avg_tov)} color={c.secondaryText} />
        <StatBox label="FG%" value={`${fgPct}%`} color={c.secondaryText} />
        <StatBox label="3P%" value={`${threePct}%`} color={c.secondaryText} />
        <StatBox label="FT%" value={`${ftPct}%`} color={c.secondaryText} />
        <StatBox label="MPG" value={String(player.avg_min)} color={c.secondaryText} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: s(16),
    marginBottom: 0,
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(4),
  },
  rankGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  fptsInline: {
    fontSize: ms(13),
    fontWeight: "700",
  },
  rankBadge: {
    paddingHorizontal: s(5),
    paddingVertical: s(1),
    borderRadius: 8,
  },
  rankBadgeText: {
    fontSize: ms(9),
    fontWeight: "700",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 12,
    paddingHorizontal: s(4),
    paddingTop: s(2),
    paddingBottom: s(6),
    ...cardShadow,
  },
  statBox: {
    width: "20%",
    alignItems: "center",
    paddingVertical: s(4),
  },
  statValue: {
    fontSize: ms(14),
    fontWeight: "600",
    lineHeight: ms(18),
  },
  statLabel: {
    fontSize: ms(10),
    marginBottom: s(1),
  },
});
