import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { PlayerGameLog, ScoringWeight } from "@/types/player";
import { ms, s } from "@/utils/scale";
import {
  calculateB2BImpact,
  calculateBounceBack,
  calculateHomeSplit,
} from "@/utils/scoring/playerInsights";

interface PlayerSplitsProps {
  /** Games for the active lens (windowed slice for recent windows, full log for season). */
  games: PlayerGameLog[];
  scoringWeights: ScoringWeight[] | undefined;
  /** Season FPTS/G — the bounce-back baseline. */
  seasonAvg: number | null;
}

/**
 * Situational FPTS splits — Home/Away, Back-to-Back, Bounce-back — for the
 * given games. Renders nothing when there isn't enough data (each calc
 * self-guards on sample size), so it quietly disappears at small windows.
 */
export function PlayerSplits({ games, scoringWeights, seasonAvg }: PlayerSplitsProps) {
  const c = useColors();

  const homeSplit = useMemo(
    () => (scoringWeights ? calculateHomeSplit(games, scoringWeights) : null),
    [games, scoringWeights],
  );
  const b2b = useMemo(
    () => (scoringWeights ? calculateB2BImpact(games, scoringWeights) : null),
    [games, scoringWeights],
  );
  const bounceBack = useMemo(
    () =>
      scoringWeights && seasonAvg != null
        ? calculateBounceBack(games, scoringWeights, seasonAvg)
        : null,
    [games, scoringWeights, seasonAvg],
  );

  if (!homeSplit && !b2b && !bounceBack) return null;

  return (
    <View style={[styles.wrap, { borderTopColor: c.border }]}>
      {(homeSplit || b2b) && (
        <View style={styles.row}>
          {homeSplit &&
            (() => {
              const delta = homeSplit.homeAvg - homeSplit.awayAvg;
              const betterHome = delta > 1;
              const betterAway = delta < -1;
              return (
                <View
                  style={styles.cell}
                  accessibilityLabel={`Home average ${homeSplit.homeAvg} in ${homeSplit.homeGames} games, away average ${homeSplit.awayAvg} in ${homeSplit.awayGames} games`}
                >
                  <ThemedText type="varsitySmall" style={[styles.label, { color: c.secondaryText }]}>
                    Home / Away
                  </ThemedText>
                  <View style={styles.values}>
                    <ThemedText
                      type="mono"
                      style={[styles.value, betterHome && { color: c.success }]}
                    >
                      {homeSplit.homeAvg}
                    </ThemedText>
                    <ThemedText style={[styles.divider, { color: c.secondaryText }]}>/</ThemedText>
                    <ThemedText
                      type="mono"
                      style={[styles.value, betterAway && { color: c.success }]}
                    >
                      {homeSplit.awayAvg}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
                    {homeSplit.homeGames}G / {homeSplit.awayGames}G
                  </ThemedText>
                </View>
              );
            })()}
          {b2b &&
            (() => {
              const deltaPct =
                b2b.restAvg > 0
                  ? Math.round(((b2b.b2bAvg - b2b.restAvg) / b2b.restAvg) * 100)
                  : 0;
              const deltaColor = deltaPct >= 0 ? c.success : c.danger;
              return (
                <View
                  style={styles.cell}
                  accessibilityLabel={`Back-to-back average ${b2b.b2bAvg} in ${b2b.b2bGames} games versus rest average ${b2b.restAvg}`}
                >
                  <ThemedText type="varsitySmall" style={[styles.label, { color: c.secondaryText }]}>
                    Back-to-Back
                  </ThemedText>
                  <View style={styles.values}>
                    <ThemedText type="mono" style={styles.value}>
                      {b2b.b2bAvg}
                    </ThemedText>
                    {deltaPct !== 0 && (
                      <ThemedText type="mono" style={[styles.delta, { color: deltaColor }]}>
                        {deltaPct > 0 ? "+" : ""}
                        {deltaPct}%
                      </ThemedText>
                    )}
                  </View>
                  <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
                    {b2b.b2bGames}G played{b2b.b2bSatOut > 0 ? ` · ${b2b.b2bSatOut} DNP` : ""}
                  </ThemedText>
                </View>
              );
            })()}
        </View>
      )}
      {bounceBack && (
        <View
          style={styles.bounceRow}
          accessibilityLabel={`Bounce-back rate ${bounceBack.rate} percent, recovered ${bounceBack.bounced} of ${bounceBack.badGames} below-average games`}
        >
          <ThemedText type="varsitySmall" style={[styles.label, { color: c.secondaryText }]}>
            Bounce-Back Rate
          </ThemedText>
          <View style={styles.bounceValues}>
            <ThemedText
              type="mono"
              style={[
                styles.bounceRate,
                {
                  color:
                    bounceBack.rate >= 60
                      ? c.success
                      : bounceBack.rate >= 40
                        ? c.warning
                        : c.danger,
                },
              ]}
            >
              {bounceBack.rate}%
            </ThemedText>
            <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
              Recovered {bounceBack.bounced} of {bounceBack.badGames} bad games
            </ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: s(10),
    paddingTop: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  row: {
    flexDirection: "row",
    gap: s(12),
  },
  cell: {
    flex: 1,
  },
  label: {
    fontSize: ms(9),
    letterSpacing: 0.8,
    marginBottom: s(4),
  },
  values: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(4),
  },
  value: {
    fontSize: ms(15),
  },
  divider: {
    fontSize: ms(12),
  },
  delta: {
    fontSize: ms(11),
  },
  sub: {
    fontSize: ms(10),
    marginTop: s(1),
  },
  bounceRow: {},
  bounceValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(6),
  },
  bounceRate: {
    fontSize: ms(15),
  },
});
