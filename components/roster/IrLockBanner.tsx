import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

interface IrLockBannerProps {
  players: { name: string }[];
}

/**
 * Brand alert: gold-rule eyebrow ("LINEUP ALERT") above a hairline-bordered
 * card with a subtle gold tint. Drops the yellow danger chrome the original
 * banner used in favor of the page's brand language.
 */
export function IrLockBanner({ players }: IrLockBannerProps) {
  const c = useColors();
  const isPlural = players.length > 1;
  const names = players.map((p) => p.name).join(", ");

  return (
    <View
      style={styles.wrap}
      accessibilityRole="alert"
      accessibilityLabel="Roster locked — illegal IR"
    >
      <View style={styles.eyebrowRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="sectionLabel"
          style={[styles.eyebrow, { color: c.text }]}
        >
          LINEUP ALERT
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
        <Ionicons name="warning" size={16} color={c.gold} />
        <ThemedText style={[styles.body, { color: c.text }]}>
          Roster moves locked —{" "}
          <ThemedText
            type="defaultSemiBold"
            style={[styles.body, { color: c.gold }]}
          >
            {names}
          </ThemedText>{" "}
          {isPlural ? "are" : "is"} on IR but no longer injured. Activate them
          to unlock your roster.
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
