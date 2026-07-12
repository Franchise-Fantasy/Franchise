import { useCallback, useRef } from "react";
import { LayoutChangeEvent, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

import { TeamLogo } from "@/components/team/TeamLogo";
import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { type TeamStanding } from "@/utils/league/standingsQueries";
import { ms, s } from "@/utils/scale";

interface TeamRailProps {
  /** Teams in standings order — `fetchStandingsTeams` already sorts them. */
  teams: TeamStanding[];
  selectedTeamId: string;
  /** The signed-in user's team — marked with a gold ring wherever it sits. */
  myTeamId: string;
  onSelect: (teamId: string) => void;
}

function recordLabel(t: TeamStanding): string {
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
}

/**
 * League switcher for the analytics page — a rail of team logos in standings
 * order. The selected team expands into a pill carrying its name and record, so
 * the rail labels the chart below it without spending a second row on a title;
 * every other team stays a bare puck. Uses the BrandSegmented chyron language (a
 * turf underline over a hairline baseline) so it reads as the same family of
 * control as the app's other tab strips.
 *
 * Switching is free — `useLeagueRosterStats` already holds every team's players,
 * so `onSelect` only re-filters data that's in memory.
 */
export function TeamRail({ teams, selectedTeamId, myTeamId, onSelect }: TeamRailProps) {
  const c = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());

  // Keep the selected pill in view — it can sit anywhere in the standings, and
  // on first render it's the user's own team, which is often mid-table.
  const revealSelected = useCallback(() => {
    const x = offsets.current.get(selectedTeamId);
    if (x == null) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - s(16)), animated: true });
  }, [selectedTeamId]);

  const onItemLayout = useCallback(
    (teamId: string) => (e: LayoutChangeEvent) => {
      offsets.current.set(teamId, e.nativeEvent.layout.x);
      if (teamId === selectedTeamId) revealSelected();
    },
    [selectedTeamId, revealSelected],
  );

  return (
    <View style={[styles.bar, { borderBottomColor: c.border }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        accessibilityRole="tablist"
        accessibilityLabel="League teams"
      >
        {teams.map((team) => {
          const isSelected = team.id === selectedTeamId;
          const isMine = team.id === myTeamId;
          const record = recordLabel(team);

          return (
            <TouchableOpacity
              key={team.id}
              onLayout={onItemLayout(team.id)}
              onPress={() => onSelect(team.id)}
              activeOpacity={0.7}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${team.name}, ${record}${isMine ? ", your team" : ""}`}
              accessibilityHint={isSelected ? undefined : "Shows this team's roster analytics"}
            >
              <View
                style={[
                  styles.pill,
                  isSelected && {
                    backgroundColor: c.card,
                    borderColor: c.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.logoRing,
                    { borderColor: isMine ? c.gold : "transparent" },
                  ]}
                >
                  {/* Only the logo dims. The gold ring is the one thing that
                      makes the user's own team findable in a 12-team rail, so
                      fading it would defeat the marker. */}
                  <View style={!isSelected && styles.dimmed}>
                    <TeamLogo
                      logoKey={team.logo_key}
                      teamName={team.name}
                      tricode={team.tricode ?? undefined}
                      size="medium"
                    />
                  </View>
                </View>

                {isSelected ? (
                  <View style={styles.pillText}>
                    <ThemedText
                      type="varsity"
                      style={[styles.pillName, { color: c.text }]}
                      numberOfLines={1}
                    >
                      {team.name}
                    </ThemedText>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.pillRecord, { color: c.secondaryText }]}
                    >
                      {record}
                    </ThemedText>
                  </View>
                ) : null}
              </View>

              {/* Chyron — same active-tab underline BrandSegmented uses. */}
              <View
                style={[
                  styles.chyron,
                  isSelected && { backgroundColor: c.primary },
                ]}
              />
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
  content: {
    paddingHorizontal: s(16),
    gap: s(8),
    alignItems: "flex-end",
  },
  item: {
    alignItems: "stretch",
    paddingTop: s(8),
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 8,
    paddingVertical: s(4),
    paddingHorizontal: s(5),
  },
  // 2px ring hugging the 36px medium logo. Gold on the user's own team so it
  // stays findable in a 12-team rail; transparent (but still occupying space)
  // on everyone else so pucks don't shift width when the selection moves.
  logoRing: {
    borderWidth: 2,
    borderRadius: 22,
    padding: s(1),
  },
  dimmed: {
    opacity: 0.45,
  },
  pillText: {
    paddingRight: s(4),
  },
  pillName: {
    fontSize: ms(12),
    letterSpacing: 0.9,
    maxWidth: s(140),
  },
  pillRecord: {
    fontSize: ms(9.5),
    letterSpacing: 1.1,
    marginTop: s(1),
  },
  chyron: {
    marginTop: s(6),
    height: 2,
    width: "100%",
    backgroundColor: "transparent",
  },
});
