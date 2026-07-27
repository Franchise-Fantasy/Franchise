import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";

/**
 * Heading for a panel on a desktop web dashboard — a short gold rule + caps
 * label, with an optional info affordance on the right. Shared by the
 * wide-screen screens (standings, draft hub) so every panel edge reads the
 * same. Web-only in practice; the desktop screens that use it never render on
 * native.
 */
export function PanelHeader({
  title,
  onInfo,
}: {
  title: string;
  /** Renders an ⓘ button on the right when provided. */
  onInfo?: () => void;
}) {
  const c = useColors();
  return (
    <View style={styles.head}>
      <View style={styles.left}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          {title}
        </ThemedText>
      </View>
      {onInfo && (
        <TouchableOpacity
          onPress={onInfo}
          accessibilityRole="button"
          accessibilityLabel={`About ${title}`}
          hitSlop={8}
        >
          <Ionicons name="information-circle-outline" size={18} color={c.secondaryText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rule: {
    height: 2,
    width: 18,
  },
});
