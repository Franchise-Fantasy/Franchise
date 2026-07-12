import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

interface ByeWeekBannerProps {
  /** Starters whose pro team has no game this league week. */
  players: { name: string }[];
}

/**
 * NFL bye-week lineup warning — same brand-alert chrome as IrLockBanner
 * (gold-rule eyebrow + hairline gold-tinted card). Informational only:
 * nothing is locked, the user just probably wants to bench these starters.
 */
export function ByeWeekBanner({ players }: ByeWeekBannerProps) {
  const c = useColors();
  const isPlural = players.length > 1;
  const names = players.map((p) => p.name).join(", ");

  return (
    <View
      style={styles.wrap}
      accessibilityRole="alert"
      accessibilityLabel={`${names} ${isPlural ? "are" : "is"} on bye this week`}
    >
      <View style={styles.eyebrowRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="sectionLabel"
          style={[styles.eyebrow, { color: c.text }]}
        >
          BYE WEEK
        </ThemedText>
      </View>
      <View
        style={[
          styles.card,
          {
            backgroundColor: c.gold + "14",
            borderColor: c.gold,
          },
        ]}
      >
        <Ionicons name="calendar-outline" size={16} color={c.gold} />
        <ThemedText style={[styles.body, { color: c.text }]}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.body, { color: c.gold }]}
          >
            {names}
          </ThemedText>{" "}
          {isPlural ? "are" : "is"} starting but on bye this week — no games,
          no points. Swap {isPlural ? "them" : "this starter"} out before
          kickoff.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: s(16),
    paddingTop: s(10),
    paddingBottom: s(4),
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
    marginBottom: s(6),
  },
  rule: {
    height: 2,
    width: s(18),
  },
  eyebrow: {
    fontSize: ms(13),
    letterSpacing: 1.0,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: s(8),
    padding: s(10),
    borderRadius: 8,
    borderWidth: 1,
  },
  body: {
    flex: 1,
    fontSize: ms(13),
    lineHeight: ms(17),
  },
});
