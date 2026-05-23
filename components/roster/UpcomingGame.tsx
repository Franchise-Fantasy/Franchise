import { View } from "react-native";

import { MatchupChip } from "@/components/player/MatchupChip";
import { rosterStyles } from "@/components/roster/rosterStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { formatGameTime } from "@/utils/nba/nbaSchedule";

type Palette = typeof Colors.light;

// Upcoming-game block for roster-style rows: opponent in a pill with the tipoff
// time tucked beneath it, right-aligned. Shared by the roster, team-roster, and
// slot-picker rows.
export function UpcomingGame({
  matchup,
  gameTimeUtc,
  c,
}: {
  matchup: string;
  gameTimeUtc: string | null;
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
    </View>
  );
}
