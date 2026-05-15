import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

export interface PillMatchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
}

interface MatchupPillBarProps {
  allMatchups: PillMatchup[];
  teamNames: Record<string, string>;
  /** Optional tricode lookup — when present, the pill shows tricodes
   *  rather than full team names for tighter horizontal density. */
  teamTricodes?: Record<string, string | null>;
  teamId: string | null;
  selectedMatchupId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Brand pill bar for selecting which matchup to view this week. Each pill
 * uses the leagueInfoPill chrome (rounded, hairline border, cardAlt bg)
 * with varsity caps for team labels. Selected pill switches to a gold
 * border + tinted gold background. The user's own matchup floats to the
 * left and gets a subtle gold tint even when not selected.
 */
export function MatchupPillBar({
  allMatchups,
  teamNames,
  teamTricodes,
  teamId,
  selectedMatchupId,
  onSelect,
}: MatchupPillBarProps) {
  const c = useColors();

  const labelFor = (id: string) =>
    teamTricodes?.[id] ?? teamNames[id]?.slice(0, 4)?.toUpperCase() ?? "—";

  return (
    <View
      style={[
        styles.bar,
        { borderBottomColor: c.border, backgroundColor: c.background },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {[...allMatchups]
          .sort((a, b) => {
            const aMine =
              a.home_team_id === teamId || a.away_team_id === teamId;
            const bMine =
              b.home_team_id === teamId || b.away_team_id === teamId;
            if (aMine && !bMine) return -1;
            if (!aMine && bMine) return 1;
            return 0;
          })
          .map((m) => {
            const isSelected = m.id === selectedMatchupId;
            const isMine =
              m.home_team_id === teamId || m.away_team_id === teamId;
            // For the user's own pill, show their team first regardless of
            // home/away so it matches the hero (user always on the left)
            // and the rosters below it. Other matchups stay home-vs-away.
            const userIsAway = isMine && m.away_team_id === teamId;
            const leftId = userIsAway ? m.away_team_id! : m.home_team_id;
            const rightId = userIsAway ? m.home_team_id : m.away_team_id;
            const leftLabel = labelFor(leftId);
            const rightLabel = rightId ? labelFor(rightId) : "BYE";
            const accLabel = `${teamNames[leftId] ?? "Unknown"} versus ${
              rightId ? (teamNames[rightId] ?? "Unknown") : "BYE"
            }${isMine ? ", your matchup" : ""}`;

            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => {
                  if (m.id !== selectedMatchupId) {
                    onSelect(m.id);
                  }
                }}
                style={[
                  styles.pill,
                  {
                    backgroundColor: isSelected
                      ? c.gold + "22"
                      : isMine
                        ? c.cardAlt
                        : c.card,
                    borderColor: isSelected
                      ? c.gold
                      : isMine
                        ? c.gold + "60"
                        : c.border,
                    borderWidth: isSelected ? 1.5 : 1,
                  },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={accLabel}
              >
                <ThemedText
                  type="varsitySmall"
                  style={[
                    styles.pillText,
                    { color: isSelected ? c.gold : c.text },
                  ]}
                >
                  {leftLabel}
                </ThemedText>
                <ThemedText
                  type="varsitySmall"
                  style={[
                    styles.pillVs,
                    {
                      color: isSelected ? c.gold + "AA" : c.secondaryText,
                    },
                  ]}
                >
                  vs
                </ThemedText>
                <ThemedText
                  type="varsitySmall"
                  style={[
                    styles.pillText,
                    { color: isSelected ? c.gold : c.text },
                  ]}
                >
                  {rightLabel}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    paddingHorizontal: s(12),
    paddingTop: s(4),
    paddingBottom: s(6),
    gap: s(8),
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 8,
  },
  pillText: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  pillVs: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    textTransform: "lowercase",
  },
});
