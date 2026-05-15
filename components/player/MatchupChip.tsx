import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { formatGameTime } from "@/utils/nba/nbaSchedule";
import { ms, s } from "@/utils/scale";

type Palette = typeof Colors.light;

// Canonical "team @ team" pill shown next to a player on roster, matchup,
// and anywhere else a game opponent appears. Live games tint success;
// scheduled games (with a gameTimeUtc) append " · 7:30 PM".
export function MatchupChip({
  matchup,
  isLive = false,
  c,
  gameTimeUtc,
  alignSelf = "flex-start",
}: {
  matchup: string;
  isLive?: boolean;
  c: Palette;
  gameTimeUtc?: string | null;
  alignSelf?: "flex-start" | "flex-end" | "auto";
}) {
  const timeLabel = gameTimeUtc && !isLive ? formatGameTime(gameTimeUtc) : null;
  const display = timeLabel ? `${matchup} · ${timeLabel}` : matchup;
  return (
    <View
      accessible={false}
      style={[
        styles.chip,
        {
          alignSelf,
          backgroundColor: isLive ? c.success + "1A" : c.cardAlt,
          borderColor: isLive ? c.success : c.border,
        },
      ]}
      accessibilityLabel={`Matchup: ${matchup}${timeLabel ? `, ${timeLabel}` : ""}${isLive ? ", live" : ""}`}
    >
      <ThemedText
        type="varsitySmall"
        style={[styles.chipText, { color: isLive ? c.success : c.text }]}
        numberOfLines={1}
      >
        {display}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 6,
    borderWidth: 1,
  },
  chipText: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
});
