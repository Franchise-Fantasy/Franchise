import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Fonts } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

export type ChatFilter = "all" | "chat" | "trade" | "rumor" | "poll" | "survey";

interface ChatFilterStripProps {
  activeFilter: ChatFilter;
  onFilterChange: (filter: ChatFilter) => void;
  counts: Record<ChatFilter, number>;
  /** When false the strip slides out to the right and fades. */
  visible: boolean;
}

const FILTERS: { key: ChatFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All", icon: "apps-outline" },
  { key: "chat", label: "Chat", icon: "chatbubble-outline" },
  { key: "trade", label: "Trades", icon: "swap-horizontal-outline" },
  { key: "rumor", label: "Rumors", icon: "flame-outline" },
  { key: "poll", label: "Polls", icon: "bar-chart-outline" },
  { key: "survey", label: "Surveys", icon: "clipboard-outline" },
];

// Slide distance in pixels — overshoots the spacer's width comfortably so
// the strip is fully off-screen when hidden, regardless of layout width.
const SLIDE_DISTANCE = 240;
const ANIM_DURATION = 200;

export function ChatFilterStrip({
  activeFilter,
  onFilterChange,
  counts,
  visible,
}: ChatFilterStripProps) {
  const c = useColors();

  const visibleFilters = useMemo(
    () => FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0),
    [counts],
  );

  // Controlled translate + opacity so collapse plays the reverse of expand,
  // even though the parent's conditional render pattern would normally tear
  // the strip down before a layout-animation exit could play.
  const translateX = useSharedValue(visible ? 0 : SLIDE_DISTANCE);
  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    translateX.value = withTiming(visible ? 0 : SLIDE_DISTANCE, {
      duration: ANIM_DURATION,
    });
    opacity.value = withTiming(visible ? 1 : 0, { duration: ANIM_DURATION });
  }, [visible, translateX, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.wrapper, animStyle]}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityRole="tablist"
      accessibilityLabel="Filter messages by type"
      accessibilityState={{ expanded: visible }}
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
                  backgroundColor: isActive ? c.gold : c.card,
                  borderColor: isActive ? c.gold : c.border,
                },
              ]}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${f.label}, ${count} message${count !== 1 ? "s" : ""}`}
            >
              <Ionicons
                name={f.icon}
                size={ms(12)}
                color={isActive ? Brand.ink : c.secondaryText}
                accessible={false}
              />
              <ThemedText
                style={[
                  styles.chipLabel,
                  { color: isActive ? Brand.ink : c.text },
                ]}
              >
                {f.label.toUpperCase()}
              </ThemedText>
              {count > 0 && (
                <ThemedText
                  style={[
                    styles.chipCount,
                    { color: isActive ? Brand.ink : c.secondaryText },
                  ]}
                >
                  {count}
                </ThemedText>
              )}
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
    height: s(26),
    paddingHorizontal: s(10),
    borderRadius: s(13),
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  chipCount: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 0.5,
    marginLeft: s(1),
  },
});
