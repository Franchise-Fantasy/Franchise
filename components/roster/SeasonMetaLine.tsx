import { View } from "react-native";

import type { SeasonAverages } from "@/components/roster/rosterData";
import { rosterStyles } from "@/components/roster/rosterStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { formatPosition } from "@/utils/formatting";

type Palette = typeof Colors.light;

// Context line on roster-style rows without actual stats for the date: the
// player's position followed by their season fpts-per-game average (points
// leagues) or box-score averages (category leagues). `seasonAvg` is null when
// there's nothing to show (0 games, or the caller suppresses it, e.g. on past
// dates) — the line then renders the position alone. Shared by the roster,
// team-roster, and slot-picker rows so the treatment can't drift.
export function SeasonMetaLine({
  position,
  seasonAvg,
  c,
}: {
  position: string;
  seasonAvg: SeasonAverages | null;
  c: Palette;
}) {
  return (
    <View style={rosterStyles.slotFptsRow}>
      <ThemedText
        type="varsitySmall"
        style={[rosterStyles.slotPosLabel, { color: c.secondaryText }]}
        numberOfLines={1}
      >
        {formatPosition(position)}
      </ThemedText>
      {seasonAvg?.fpts ? (
        <>
          <ThemedText style={[rosterStyles.slotPosDot, { color: c.secondaryText }]}>
            ·
          </ThemedText>
          <ThemedText numberOfLines={1}>
            <ThemedText style={[rosterStyles.slotAvgFpts, { color: c.gold }]}>
              {seasonAvg.fpts}
            </ThemedText>
            <ThemedText
              type="varsitySmall"
              style={[rosterStyles.slotPosLabel, { color: c.secondaryText }]}
            >
              {" FPTS/G"}
            </ThemedText>
          </ThemedText>
        </>
      ) : seasonAvg?.stats ? (
        <>
          <ThemedText style={[rosterStyles.slotPosDot, { color: c.secondaryText }]}>
            ·
          </ThemedText>
          <ThemedText
            style={[
              rosterStyles.slotStatLine,
              { color: c.secondaryText, marginTop: 0 },
            ]}
            numberOfLines={1}
          >
            {seasonAvg.stats}
          </ThemedText>
        </>
      ) : null}
    </View>
  );
}
