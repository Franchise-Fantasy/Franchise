import { ReactNode, useEffect, useState, useCallback } from 'react';
import { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

interface AnimatedSectionProps {
  visible: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const DURATION = 280;
const EASING = Easing.out(Easing.cubic);

/**
 * Smoothly expands/collapses children by animating height and opacity together.
 * Always renders children so height can be measured; clips overflow during animation.
 */
export function AnimatedSection({ visible, children, style }: AnimatedSectionProps) {
  const measuredHeight = useSharedValue(0);
  const animatedHeight = useSharedValue(visible ? -1 : 0); // -1 = auto (use measured)
  const opacity = useSharedValue(visible ? 1 : 0);
  const [shouldRender, setShouldRender] = useState(visible);

  const handleCollapsed = useCallback(() => {
    setShouldRender(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      // Expand: animate to measured height, then let it be auto
      animatedHeight.value = withTiming(measuredHeight.value, { duration: DURATION, easing: EASING });
      opacity.value = withTiming(1, { duration: DURATION, easing: EASING });
    } else {
      // Collapse: animate to 0
      animatedHeight.value = withTiming(0, { duration: DURATION, easing: EASING }, (finished) => {
        if (finished) runOnJS(handleCollapsed)();
      });
      opacity.value = withTiming(0, { duration: DURATION * 0.6, easing: EASING });
    }
  }, [visible]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) {
      measuredHeight.value = h;
      // If already visible and this is the first measure, snap open
      if (animatedHeight.value === -1) {
        animatedHeight.value = h;
      }
    }
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value <= 0 ? 0 : animatedHeight.value,
    opacity: opacity.value,
    overflow: 'hidden' as const,
  }));

  if (!shouldRender && !visible) return null;

  return (
    <Animated.View
      style={[containerStyle, style]}
      accessibilityLiveRegion="polite"
    >
      {/* Inner wrapper measures the natural height of children */}
      <Animated.View
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        onLayout={onLayout}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
