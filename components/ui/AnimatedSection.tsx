import { ReactNode, useEffect, useRef, useCallback } from 'react';
import { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { s } from '@/utils/scale';

interface AnimatedSectionProps {
  visible: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Pixels to subtract from marginBottom when collapsed, to cancel the
   * parent's `gap` contribution. Default s(14) matches `FormSection`'s
   * standard inter-field gap. Pass 0 if the parent doesn't use `gap`.
   */
  gapCompensation?: number;
}

const DURATION = 280;
const EASING = Easing.out(Easing.cubic);

/**
 * Smoothly expands/collapses children by animating height + opacity
 * **and** a compensating marginBottom.
 *
 * **Why the marginBottom dance:** FormSection uses `gap: 14` to space
 * its children. Even a 0-height child still has 14px of `gap` applied
 * around it, so a collapsed AnimatedSection would leave dead
 * whitespace in the card — the form "looks like it's preparing to
 * show something here." We cancel that out by animating marginBottom
 * to -gapCompensation when closed, so the collapsed section's total
 * layout footprint becomes 0.
 *
 * Children are never unmounted — that avoids the old "snap" jump at
 * the end of the close animation (caused by the parent's gap
 * disappearing the moment the child was removed) and lets form state
 * persist across visibility toggles.
 *
 * First-open flow: `useEffect` can't start the height animation
 * because children haven't rendered yet and `measuredHeight` is still
 * 0; `onLayout` picks up the slack once the real height is known.
 */
export function AnimatedSection({
  visible,
  children,
  style,
  gapCompensation = s(14),
}: AnimatedSectionProps) {
  const measuredHeight = useSharedValue(0);
  // Sentinel -1 = "visible on mount, snap to measured height once known".
  const animatedHeight = useSharedValue(visible ? -1 : 0);
  const opacity = useSharedValue(visible ? 1 : 0);
  const marginBottom = useSharedValue(visible ? 0 : -gapCompensation);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (visible) {
      opacity.value = withTiming(1, { duration: DURATION, easing: EASING });
      marginBottom.value = withTiming(0, { duration: DURATION, easing: EASING });
      if (measuredHeight.value > 0) {
        animatedHeight.value = withTiming(measuredHeight.value, {
          duration: DURATION,
          easing: EASING,
        });
      }
      // else: onLayout will kick off the expand once children mount.
    } else {
      animatedHeight.value = withTiming(0, { duration: DURATION, easing: EASING });
      opacity.value = withTiming(0, { duration: DURATION * 0.6, easing: EASING });
      marginBottom.value = withTiming(-gapCompensation, {
        duration: DURATION,
        easing: EASING,
      });
    }
  }, [visible, gapCompensation]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;

      const prev = measuredHeight.value;
      measuredHeight.value = h;

      if (animatedHeight.value === -1) {
        animatedHeight.value = h;
        return;
      }
      if (!visible) return;
      const shouldAnimate =
        animatedHeight.value === 0 || Math.abs(h - prev) > 1;
      if (shouldAnimate) {
        animatedHeight.value = withTiming(h, { duration: DURATION, easing: EASING });
      }
    },
    [visible],
  );

  const containerStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value <= 0 ? 0 : animatedHeight.value,
    opacity: opacity.value,
    marginBottom: marginBottom.value,
    overflow: 'hidden' as const,
  }));

  return (
    <Animated.View style={[containerStyle, style]} accessibilityLiveRegion="polite">
      <Animated.View
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        onLayout={onLayout}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
