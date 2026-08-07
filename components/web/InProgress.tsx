import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";

/**
 * The "not ported yet" treatment for the web beta. Two pieces that share one
 * vocabulary so a gated destination reads the same wherever it surfaces:
 *
 *  - InProgressChip   — inline tag on a nav row or dashboard card, marking the
 *                       thing next to it as unavailable rather than broken.
 *  - InProgressScreen — the full page shown when a gated route is reached
 *                       anyway (typed URL, deep link, notification tap).
 *
 * Which routes are gated lives in utils/web/webRouteStatus.ts — these are
 * presentation only. Reached exclusively from web chrome plus one shared card
 * (AnalyticsPreviewCard), and built from plain RN primitives, so it's safe in
 * either bundle.
 */

export function InProgressChip({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View
      style={[styles.chip, { backgroundColor: c.cardAlt, borderColor: c.border }, style]}
      // The label is announced by the parent row/card, which names the
      // destination too — a standalone "in progress" reading would be orphaned.
      accessible={false}
    >
      <ThemedText style={[styles.chipText, { color: c.secondaryText }]}>IN PROGRESS</ThemedText>
    </View>
  );
}

export function InProgressScreen({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={styles.root}>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={[styles.iconRing, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
          <Ionicons name="construct-outline" size={26} color={c.secondaryText} />
        </View>

        <ThemedText type="varsity" style={[styles.title, { color: c.text }]} accessibilityRole="header">
          {label.toUpperCase()}
        </ThemedText>

        <View style={[styles.statusPill, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <ThemedText style={[styles.statusText, { color: c.secondaryText }]}>IN PROGRESS</ThemedText>
        </View>

        <ThemedText style={[styles.body, { color: c.secondaryText }]}>
          This page isn&apos;t on the web app yet. It&apos;s fully available in the Franchise mobile
          app while we finish building it out for desktop.
        </ThemedText>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <ThemedText style={[styles.footnote, { color: c.secondaryText }]}>
          Ready on web today: your home dashboard, league creation, the draft room, and chat.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: {
    fontFamily: Fonts.varsitySemibold,
    fontSize: 8.5,
    letterSpacing: 0.7,
    lineHeight: 12,
  },
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 32,
    paddingVertical: 36,
    alignItems: "center",
  },
  iconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  title: {
    fontSize: 19,
    letterSpacing: 1.6,
    textAlign: "center",
    marginBottom: 12,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 18,
  },
  statusText: {
    fontFamily: Fonts.varsitySemibold,
    fontSize: 10,
    letterSpacing: 1,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: 20,
  },
  footnote: {
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: "center",
  },
});
