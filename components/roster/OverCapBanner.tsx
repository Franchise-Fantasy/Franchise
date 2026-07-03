import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

interface OverCapBannerProps {
  /** Active roster count (non-IR, non-TAXI). */
  activeCount: number;
  /** League's roster_size cap. */
  rosterSize: number;
  /** How many players need to be dropped / moved to clear the lock. */
  overBy: number;
  /** League has taxi-squad slots — offer TAXI as an unlock destination. */
  hasTaxi: boolean;
  /** League has IR slots — offer IR as an unlock destination. */
  hasIR: boolean;
}

/**
 * Brand alert for active-roster over-capacity. Mirrors `IrLockBanner`'s
 * chrome (gold rule eyebrow + tinted card) so the two lock surfaces read
 * as the same alert family. Typical trigger: a team accumulated more
 * picks than they could use via mid-draft trades and ended up over the
 * cap after the draft completed.
 */
export function OverCapBanner({
  activeCount,
  rosterSize,
  overBy,
  hasTaxi,
  hasIR,
}: OverCapBannerProps) {
  const c = useColors();
  const noun = overBy === 1 ? "player" : "players";
  // Only surface destinations the league actually has (e.g. no "TAXI" when
  // taxi squad is off). With neither, dropping is the only way to unlock.
  const destPhrase = [hasTaxi && "TAXI", hasIR && "IR"]
    .filter(Boolean)
    .join(" or ");

  return (
    <View
      style={styles.wrap}
      accessibilityRole="alert"
      accessibilityLabel="Roster locked — over capacity"
    >
      <View style={styles.eyebrowRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="sectionLabel"
          style={[styles.eyebrow, { color: c.text }]}
        >
          ROSTER ALERT
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
            {activeCount}/{rosterSize}
          </ThemedText>{" "}
          active. {destPhrase ? "Drop or move" : "Drop"}{" "}
          <ThemedText
            type="defaultSemiBold"
            style={[styles.body, { color: c.gold }]}
          >
            {overBy} {noun}
          </ThemedText>
          {destPhrase ? ` to ${destPhrase} to unlock.` : " to unlock."}
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
