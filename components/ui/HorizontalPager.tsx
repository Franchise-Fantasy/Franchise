import { Colors } from "@/constants/Colors";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import React, { useCallback, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";

interface HorizontalPagerProps {
  children: React.ReactNode[];
  pageLabels?: string[];
  style?: ViewStyle;
  /** When set, clips each page to this height and shows a "More" button if content overflows. */
  fixedHeight?: number;
}

export function HorizontalPager({
  children,
  pageLabels,
  style,
  fixedHeight,
}: HorizontalPagerProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const [activeIndex, setActiveIndex] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Track which pages have been expanded and which overflow
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());
  const [overflowPages, setOverflowPages] = useState<Set<number>>(new Set());

  const onLayout = (e: LayoutChangeEvent) => {
    setPageWidth(e.nativeEvent.layout.width);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth > 0) {
      const index = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      setActiveIndex(index);
    }
  };

  const handleContentLayout = useCallback(
    (index: number, e: LayoutChangeEvent) => {
      if (!fixedHeight) return;
      const contentHeight = e.nativeEvent.layout.height;
      setOverflowPages((prev) => {
        const next = new Set(prev);
        if (contentHeight > fixedHeight) {
          next.add(index);
        } else {
          next.delete(index);
        }
        return next;
      });
    },
    [fixedHeight],
  );

  const toggleExpand = (index: number) => {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const isExpanded = expandedPages.has(activeIndex);
  const currentOverflows = overflowPages.has(activeIndex);
  const showMore = currentOverflows && !isExpanded;
  const showLess = isExpanded;

  return (
    <View style={style} onLayout={onLayout}>
      {pageWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          scrollEventThrottle={16}
          decelerationRate="fast"
          nestedScrollEnabled
        >
          {children.map((child, i) => {
            const clipped =
              fixedHeight && !expandedPages.has(i);
            return (
              <View
                key={i}
                style={[
                  { width: pageWidth },
                  clipped
                    ? { height: fixedHeight, overflow: "hidden" }
                    : undefined,
                ]}
              >
                <View onLayout={(e) => handleContentLayout(i, e)}>
                  {child}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* More / Less toggle — always reserve space when fixedHeight is set */}
      {fixedHeight && (
        <TouchableOpacity
          onPress={() => (showMore || showLess) && toggleExpand(activeIndex)}
          style={styles.moreBtn}
          accessibilityRole="button"
          accessibilityLabel={showMore ? "Show more" : showLess ? "Show less" : undefined}
          disabled={!showMore && !showLess}
        >
          <ThemedText
            style={[
              styles.moreText,
              { color: showMore || showLess ? c.accent : "transparent" },
            ]}
          >
            {showLess ? "Less" : "More"}
          </ThemedText>
        </TouchableOpacity>
      )}

      {/* Dot indicators */}
      {children.length > 1 && (
        <View style={styles.dots} accessibilityRole="tablist">
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
              accessibilityRole="tab"
              accessibilityLabel={
                pageLabels?.[i] ?? `Page ${i + 1} of ${children.length}`
              }
              accessibilityState={{ selected: i === activeIndex }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  moreBtn: {
    alignItems: "center",
    paddingVertical: 6,
  },
  moreText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
