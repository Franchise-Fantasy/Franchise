import { Platform, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts, cardShadow } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import { ordinalSuffix } from "@/utils/formatting";
import { type LeagueStrengthComparison } from "@/utils/roster/rosterStrength";
import { ms, s } from "@/utils/scale";

interface RosterStrengthCardProps {
  comparison: LeagueStrengthComparison;
  /** Window label rendered in the eyebrow, e.g. "Season", "Last 10". */
  windowLabel: string;
  hasInactive: boolean;
}

/**
 * Roster-strength overview — LEAGUE RANK + VS-LEAGUE FPTS/G summary, matching
 * the home preview chrome. Shared by the redraft (windowed) and dynasty
 * (season) points analytics views so the card stays in one place.
 */
export function RosterStrengthCard({ comparison, windowLabel, hasInactive }: RosterStrengthCardProps) {
  const c = useColors();
  const vsAvg = comparison.myAvgFpts - comparison.leagueAvgFpts;

  return (
    <View
      style={[
        styles.strengthCard,
        {
          backgroundColor: c.heritageGoldMuted,
          borderColor: c.border,
          ...cardShadow,
          ...(Platform.OS === "android" && { elevation: 0 }),
        },
      ]}
    >
      <View style={[styles.topNotch, { backgroundColor: c.primary }]} />
      <ThemedText type="varsitySmall" style={[styles.eyebrow, { color: c.primary }]}>
        {`ROSTER STRENGTH · ${windowLabel.toUpperCase()}`}
      </ThemedText>
      <View style={styles.columnsRow}>
        <View
          style={styles.column}
          accessibilityLabel={`Ranked ${comparison.myRank}${ordinalSuffix(comparison.myRank)} of ${comparison.totalTeams} teams by roster strength`}
        >
          <ThemedText type="varsitySmall" style={[styles.columnLabel, { color: c.secondaryText }]}>
            LEAGUE RANK
          </ThemedText>
          <ThemedText type="display" style={[styles.columnBig, { color: c.text }]} numberOfLines={1}>
            {`${comparison.myRank}${ordinalSuffix(comparison.myRank)}`}
          </ThemedText>
          <ThemedText type="varsitySmall" style={[styles.columnSub, { color: c.secondaryText }]}>
            {`OF ${comparison.totalTeams}`}
          </ThemedText>
        </View>

        <View style={[styles.columnDivider, { backgroundColor: c.border }]} />

        <View
          style={styles.column}
          accessibilityLabel={`${vsAvg >= 0 ? "plus" : "minus"} ${Math.abs(vsAvg).toFixed(1)} fantasy points per game versus the league average`}
        >
          <ThemedText type="varsitySmall" style={[styles.columnLabel, { color: c.secondaryText }]}>
            VS LEAGUE
          </ThemedText>
          <ThemedText type="display" style={[styles.columnBig, { color: c.text }]} numberOfLines={1}>
            {`${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(1)}`}
          </ThemedText>
          <ThemedText type="varsitySmall" style={[styles.columnSub, { color: c.secondaryText }]}>
            FPTS/G VS AVG
          </ThemedText>
        </View>
      </View>

      {hasInactive && (
        <ThemedText type="varsitySmall" style={[styles.strengthNote, { color: c.secondaryText }]}>
          ACTIVE ROSTER ONLY · IR &amp; TAXI NOT COUNTED
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strengthCard: {
    position: "relative",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(18),
    paddingBottom: s(14),
    marginBottom: s(14),
    overflow: "hidden",
  },
  topNotch: {
    position: "absolute",
    top: 0,
    left: s(16),
    height: 3,
    width: s(44),
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(12),
  },
  columnsRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  column: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: s(2),
  },
  columnLabel: {
    fontSize: ms(9.5),
    letterSpacing: 1.2,
    marginBottom: s(4),
  },
  columnBig: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
    marginBottom: s(2),
  },
  columnSub: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
  },
  columnDivider: {
    width: 1,
    marginHorizontal: s(8),
  },
  strengthNote: {
    fontSize: ms(8.5),
    letterSpacing: 0.8,
    marginTop: s(12),
  },
});
