import { View } from "react-native";

import { MatchupChip } from "@/components/player/MatchupChip";
import { rosterStyles } from "@/components/roster/rosterStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { formatGameTime } from "@/utils/nba/nbaSchedule";

type Palette = typeof Colors.light;

// Upcoming-game block for roster-style rows: opponent in a pill with the tipoff
// time tucked beneath it, right-aligned. When a next-game projection exists for
// the player (points leagues), the projected fantasy points sit under the time —
// so the projection only ever appears for players who actually have a game.
// Shared by the roster, team-roster, and slot-picker rows.
export function UpcomingGame({
  matchup,
  gameTimeUtc,
  projFpts,
  c,
}: {
  matchup: string;
  gameTimeUtc: string | null;
  /** Projected fantasy points for this upcoming game, pre-formatted (e.g.
   *  "18.3"). Null/undefined hides the line — categories leagues, missing
   *  projection, or the slot-picker which doesn't pass it. */
  projFpts?: string | null;
  c: Palette;
}) {
  return (
    <View style={rosterStyles.slotGameInfo} accessible={false}>
      <MatchupChip matchup={matchup} c={c} alignSelf="flex-end" />
      {gameTimeUtc ? (
        <ThemedText
          style={[rosterStyles.slotGameTime, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          {formatGameTime(gameTimeUtc)}
        </ThemedText>
      ) : null}
      {projFpts ? (
        <ThemedText
          style={[rosterStyles.slotGameProj, { color: c.gold }]}
          numberOfLines={1}
          accessibilityLabel={`Projected ${projFpts} fantasy points`}
        >
          {projFpts} PROJ
        </ThemedText>
      ) : null}
    </View>
  );
}
