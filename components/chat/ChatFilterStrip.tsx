import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import Animated, { SlideInRight, SlideOutRight } from "react-native-reanimated";

import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ms, s } from "@/utils/scale";

export type ChatFilter = "all" | "chat" | "trade" | "rumor" | "poll" | "survey";

interface ChatFilterStripProps {
  activeFilter: ChatFilter;
  onFilterChange: (filter: ChatFilter) => void;
  counts: Record<ChatFilter, number>;
}

const FILTERS: { key: ChatFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All", icon: "apps-outline" },
  { key: "chat", label: "Chat", icon: "chatbubble-outline" },
  { key: "trade", label: "Trades", icon: "swap-horizontal-outline" },
  { key: "rumor", label: "Rumors", icon: "flame-outline" },
  { key: "poll", label: "Polls", icon: "bar-chart-outline" },
  { key: "survey", label: "Surveys", icon: "clipboard-outline" },
];

export function ChatFilterStrip({
  activeFilter,
  onFilterChange,
  counts,
}: ChatFilterStripProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  const visibleFilters = useMemo(
    () => FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0),
    [counts],
  );

  return (
    <Animated.View
      entering={SlideInRight.duration(200)}
      exiting={SlideOutRight.duration(150)}
      style={styles.wrapper}
      accessibilityRole="tablist"
      accessibilityLabel="Filter messages by type"
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {visibleFilters.map((f) => {
          const isActive = activeFilter === f.key;
          const count = counts[f.key];
          return (
            <TouchableOpacity
              key={f.key}
              onPress={() => onFilterChange(f.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? c.accent : c.card,
                  borderColor: isActive ? c.accent : c.border,
                },
              ]}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${f.label}, ${count} message${count !== 1 ? "s" : ""}`}
            >
              <Ionicons
                name={f.icon}
                size={13}
                color={isActive ? c.accentText : c.secondaryText}
                accessible={false}
              />
              <ThemedText
                style={[
                  styles.chipLabel,
                  { color: isActive ? c.accentText : c.text },
                ]}
              >
                {f.label} {count}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    overflow: "hidden",
  },
  scroll: {
    alignItems: "center",
    justifyContent: "flex-end",
    flexGrow: 1,
    gap: s(6),
    paddingLeft: s(8),
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    paddingHorizontal: s(9),
    paddingVertical: s(4),
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: {
    fontSize: ms(12),
    fontWeight: "600",
  },
});
