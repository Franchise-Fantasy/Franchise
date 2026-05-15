import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

interface SectionEyebrowProps {
  label: string;
  /** Optional element rendered inline immediately after the label. */
  leftAccessory?: ReactNode;
  /** Optional content rendered right-aligned in the eyebrow row (pills, badges). */
  right?: ReactNode;
}

/**
 * Brand-language section eyebrow: gold rule + sectionLabel caps + optional
 * right slot. Matches the pattern used in Home (StandingsSection) and Free
 * Agents (RosterNeedsStrip).
 */
export function SectionEyebrow({ label, leftAccessory, right }: SectionEyebrowProps) {
  const c = useColors();

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="sectionLabel"
          style={[styles.label, { color: c.text }]}
          accessibilityRole="header"
        >
          {label}
        </ThemedText>
        {leftAccessory}
      </View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: s(8),
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
    flexShrink: 1,
  },
  rule: {
    height: 2,
    width: s(18),
  },
  label: {
    fontSize: ms(13),
    letterSpacing: 1.0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
});
