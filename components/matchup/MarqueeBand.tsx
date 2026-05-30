import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { ms, s } from '@/utils/scale';

// Marquee speed. Tuned to feel "live ticker" rather than "stock crawl" —
// fast enough to read but not so fast you can't catch a name as it passes.
const SCROLL_SPEED_PX_PER_SEC = 38;

interface MarqueeBandProps {
  /** Left-edge label chip, e.g. "RECAP" / "UP NEXT". */
  label: string;
  /** Pre-built chips. Each must carry its own stable key. */
  items: ReactNode[];
  /** Copy shown when there are no items (caller decides based on day state). */
  emptyText: string;
  /** Spoken summary of the whole band for screen readers. */
  a11yLabel: string;
}

/**
 * Presentational auto-scrolling band for the matchup hero. Renders the chips
 * end-to-end inside an animated row that translates left at a constant speed —
 * when the first copy slides off, the next copy is already in position so the
 * loop is seamless. Falls back to a static row when the content fits the
 * visible track. Knows nothing about what the chips contain: the live recap,
 * upcoming-games, and past-recap tickers all feed it pre-built chips.
 */
export function MarqueeBand({ label, items, emptyText, a11yLabel }: MarqueeBandProps) {
  const [singleCopyWidth, setSingleCopyWidth] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useSharedValue(0);

  // Marquee math. We need enough copies of `items` end-to-end that "one cycle"
  // (the distance we translate before looping) covers the full track width —
  // otherwise the duplicate copy ends up visible alongside the original, which
  // reads as the same chip appearing twice. With short content (1–2 chips),
  // padFactor grows so each visible window only ever sees the "first half".
  const padFactor = useMemo(() => {
    if (singleCopyWidth <= 0 || trackWidth <= 0) return 1;
    return Math.max(1, Math.ceil(trackWidth / singleCopyWidth));
  }, [singleCopyWidth, trackWidth]);
  const copies = padFactor * 2;
  const cycleWidth = singleCopyWidth * padFactor;

  useEffect(() => {
    cancelAnimation(translateX);
    if (cycleWidth <= 0) {
      translateX.value = 0;
      return;
    }
    const duration = (cycleWidth / SCROLL_SPEED_PX_PER_SEC) * 1000;
    translateX.value = 0;
    translateX.value = withRepeat(
      withTiming(-cycleWidth, { duration, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(translateX);
  }, [cycleWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.bar} accessibilityRole="text" accessibilityLabel={a11yLabel}>
      <View style={styles.recapChip}>
        <ThemedText type="varsity" style={styles.recapText}>
          {label}
        </ThemedText>
      </View>
      <View
        style={styles.track}
        pointerEvents="none"
        onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {items.length === 0 ? (
          <ThemedText type="varsitySmall" style={styles.emptyText} numberOfLines={1}>
            {emptyText}
          </ThemedText>
        ) : (
          <>
            {/* Hidden measurer — one copy, used to derive singleCopyWidth so
                padFactor can size the visible ribbon. Absolutely positioned +
                opacity 0 so it doesn't affect layout or draw. */}
            <View
              style={[styles.row, styles.measurer]}
              pointerEvents="none"
              onLayout={(e: LayoutChangeEvent) =>
                setSingleCopyWidth(e.nativeEvent.layout.width)
              }
            >
              {items}
            </View>
            <Animated.View style={[styles.row, animatedStyle]}>
              {Array.from({ length: copies }).flatMap((_, copyIdx) =>
                items.map((node, idx) => (
                  <React.Fragment key={`${copyIdx}-${idx}`}>{node}</React.Fragment>
                )),
              )}
            </Animated.View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: ms(28),
    // Pull the band edge-to-edge across the hero card AND consume the card's
    // paddingBottom so the bar bleeds into the rounded bottom edge. The hero's
    // overflow:hidden + borderRadius:16 clip the bottom corners to the card's
    // curve. Horizontal margin must match the hero card's paddingHorizontal.
    marginHorizontal: s(-14),
    marginTop: s(10),
    marginBottom: s(-8),
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(181, 123, 48, 0.45)',
    overflow: 'hidden',
  },
  recapChip: {
    paddingHorizontal: s(10),
    justifyContent: 'center',
    backgroundColor: Brand.vintageGold,
  },
  recapText: {
    color: Brand.ink,
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  track: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingLeft: s(10),
  },
  emptyText: {
    color: Brand.ecruMuted,
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  measurer: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
  },
});

// Shared chip atoms so the three tickers (live recap, upcoming, past recap)
// read as one visual language: a name, an optional value, a detail, an
// optional muted caption, and a trailing separator dot.
export const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingRight: s(10),
  },
  name: {
    color: Brand.ecru,
    fontSize: ms(10),
    letterSpacing: 0.6,
  },
  value: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    fontWeight: '700',
  },
  detail: {
    color: Brand.ecru,
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  muted: {
    color: Brand.ecruMuted,
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    letterSpacing: 0.3,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(181, 123, 48, 0.55)',
    marginLeft: s(8),
  },
});
