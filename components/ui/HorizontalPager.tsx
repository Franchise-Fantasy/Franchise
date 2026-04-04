import { Colors } from "@/constants/Colors";
import { ThemedText } from "@/components/ui/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  TouchableOpacity,
  UIManager,
  View,
  ViewStyle,
} from "react-native";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SWIPE_THRESHOLD = 50;

interface HorizontalPagerProps {
  children: React.ReactNode[];
  pageLabels: string[];
  style?: ViewStyle;
  /** Minimum height for the content area to prevent layout shift when switching tabs. */
  minHeight?: number;
  /** Which page to show initially. Defaults to 0. */
  initialIndex?: number;
}

export function HorizontalPager({
  children,
  pageLabels,
  style,
  minHeight,
  initialIndex,
}: HorizontalPagerProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const [activeIndex, setActiveIndex] = useState(initialIndex ?? 0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < children.length - 1;

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= children.length || index === activeIndexRef.current) return;
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start(() => {
        setActiveIndex(index);
        activeIndexRef.current = index;
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }).start();
      });
    },
    [children.length, fadeAnim],
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only claim the gesture if it's clearly horizontal
        return (
          Math.abs(gestureState.dx) > 10 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          // Swipe left → next
          goTo(activeIndexRef.current + 1);
        } else if (gestureState.dx > SWIPE_THRESHOLD) {
          // Swipe right → prev
          goTo(activeIndexRef.current - 1);
        }
      },
    }),
  ).current;

  return (
    <View style={style}>
      {/* Navigation bar: title left, dots + arrows right */}
      <View style={styles.navBar}>
        <ThemedText
          type="subtitle"
          style={styles.title}
          accessibilityRole="header"
        >
          {pageLabels[activeIndex]}
        </ThemedText>

        <View style={styles.navRight}>
          {hasPrev && (
            <TouchableOpacity
              onPress={() => goTo(activeIndex - 1)}
              accessibilityRole="button"
              accessibilityLabel={`Go to ${pageLabels[activeIndex - 1]}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="chevron-back"
                size={16}
                color={c.secondaryText}
                accessible={false}
              />
            </TouchableOpacity>
          )}

          {/* Dots */}
          <View
            style={styles.dots}
            accessibilityLabel={`Page ${activeIndex + 1} of ${children.length}`}
          >
            {children.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i === activeIndex ? c.accent : c.border,
                  },
                ]}
              />
            ))}
          </View>

          {hasNext && (
            <TouchableOpacity
              onPress={() => goTo(activeIndex + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Go to ${pageLabels[activeIndex + 1]}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={c.secondaryText}
                accessible={false}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content — swipeable */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          minHeight ? { minHeight } : undefined,
          { opacity: fadeAnim },
        ]}
      >
        {children[activeIndex]}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  title: {
    marginBottom: 0,
  },
  navRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
