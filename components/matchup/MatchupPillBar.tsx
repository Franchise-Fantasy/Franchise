import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { styles } from "./matchupStyles";

export interface PillMatchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
}

interface MatchupPillBarProps {
  allMatchups: PillMatchup[];
  teamNames: Record<string, string>;
  teamId: string | null;
  selectedMatchupId: string | null;
  colors: {
    border: string;
    accent: string;
    activeCard: string;
    activeBorder: string;
    card: string;
    text: string;
    secondaryText: string;
  };
  onSelect: (id: string) => void;
}

export function MatchupPillBar({
  allMatchups,
  teamNames,
  teamId,
  selectedMatchupId,
  colors,
  onSelect,
}: MatchupPillBarProps) {
  return (
    <View
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillBar}
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
          .map((m, idx) => {
            const isSelected = m.id === selectedMatchupId;
            const isMine =
              m.home_team_id === teamId || m.away_team_id === teamId;
            const homeName = teamNames[m.home_team_id] ?? "Unknown";
            const awayName = m.away_team_id
              ? (teamNames[m.away_team_id] ?? "Unknown")
              : "BYE";

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
                      ? colors.accent
                      : isMine
                        ? colors.activeCard
                        : colors.card,
                  },
                  !isSelected && {
                    borderWidth: 1,
                    borderColor: isMine ? colors.activeBorder : colors.border,
                  },
                  idx === allMatchups.length - 1 && { marginRight: 0 },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${homeName} versus ${awayName}${isMine ? ", your matchup" : ""}`}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: isSelected ? "#fff" : colors.text },
                  ]}
                >
                  {homeName}
                </Text>
                <Text
                  style={[
                    styles.pillVs,
                    {
                      color: isSelected
                        ? "rgba(255,255,255,0.5)"
                        : colors.secondaryText,
                    },
                  ]}
                >
                  vs
                </Text>
                <Text
                  style={[
                    styles.pillText,
                    { color: isSelected ? "#fff" : colors.text },
                  ]}
                >
                  {awayName}
                </Text>
              </TouchableOpacity>
            );
          })}
      </ScrollView>
    </View>
  );
}
