import { StyleSheet, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";
import type { PlayerRanking } from "@/utils/scoring/playerRankings";

/**
 * Overall + positional rank pills for the player detail header.
 *
 * Pre-tipoff the ranking is computed from season projections — there are no
 * averages yet — and the caption says so. An unlabelled "#4 OVR" would read as
 * a result rather than a forecast, the same reason the averages box labels its
 * pre-season chip "'27 PROJ".
 */
export function PlayerRankBadges({ ranking }: { ranking: PlayerRanking }) {
  const c = useColors();
  const projected = ranking.basis === "projected";

  return (
    <View
      style={styles.stack}
      accessible
      accessibilityLabel={[
        projected ? "Projected ranking." : "Ranking.",
        `Number ${ranking.overallRank} of ${ranking.totalPlayers} overall.`,
        `Number ${ranking.positionRank} of ${ranking.totalAtPosition} at ${ranking.primaryPosition}.`,
      ].join(" ")}
    >
      {projected && (
        <ThemedText type="varsitySmall" style={[styles.caption, { color: c.secondaryText }]}>
          PROJECTED
        </ThemedText>
      )}
      <View style={styles.row}>
        <Badge label={`#${ranking.overallRank} OVR`} variant="gold" />
        <Badge
          label={`#${ranking.positionRank} ${ranking.primaryPosition}`}
          variant="neutral"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: "flex-end",
    gap: s(3),
  },
  caption: {
    fontSize: ms(8),
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
});
