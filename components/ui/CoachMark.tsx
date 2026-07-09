import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow } from '@/constants/Colors';
import { useCoachMark } from '@/hooks/useCoachMark';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface CoachMarkProps {
  /** Stable id — the hint shows once per device until dismissed. */
  id: string;
  /** One-line gesture/info hint. */
  text: string;
  /** Distance from the top of the (position:relative) parent. Use this OR bottom. */
  top?: number;
  /** Distance from the bottom of the parent. Use this OR top. */
  bottom?: number;
  /**
   * Gate display until the hinted gesture actually applies (e.g. more than one
   * matchup exists). Defaults to true.
   */
  active?: boolean;
}

/**
 * A dismissable one-time coach-mark. Renders as a floating, centered callout
 * pinned to the top or bottom of its parent (which must be position:relative,
 * e.g. a screen root). Fades in shortly after mount so it doesn't fight the
 * screen's own entrance, and persists "seen" on dismiss.
 */
export function CoachMark({ id, text, top, bottom, active = true }: CoachMarkProps) {
  const c = useColors();
  const { visible, dismiss } = useCoachMark(id);

  if (!visible || !active) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(350).delay(650)}
      exiting={FadeOut.duration(200)}
      style={[styles.wrap, { top, bottom }]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.card, { backgroundColor: c.text, borderColor: c.gold, ...cardShadow }]}
        accessibilityRole="alert"
      >
        <Ionicons name="bulb" size={ms(15)} color={c.gold} accessible={false} />
        <ThemedText style={[styles.text, { color: c.background }]}>{text}</ThemedText>
        <TouchableOpacity
          onPress={dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss tip"
        >
          <Ionicons name="close" size={ms(16)} color={c.background} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: s(16),
    right: s(16),
    alignItems: 'center',
    zIndex: 50,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingVertical: s(9),
    paddingHorizontal: s(13),
    borderRadius: 11,
    borderWidth: 1,
    maxWidth: s(340),
  },
  text: {
    flex: 1,
    fontSize: ms(12.5),
    lineHeight: ms(17),
  },
});
