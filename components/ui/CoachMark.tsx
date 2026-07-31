import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useDismissals } from '@/hooks/useDismissals';
import { ms, s } from '@/utils/scale';

interface CoachMarkProps {
  /** Stable id — the hint shows once per ACCOUNT, on every device, until dismissed. */
  id: string;
  /** One-line gesture/info hint. */
  text: string;
  /** Distance from the top of the (position:relative) parent. Use this OR bottom. */
  top?: number;
  /** Distance from the bottom of the parent. Use this OR top. */
  bottom?: number;
  /**
   * Render in normal document flow instead of as a floating overlay, so the hint
   * sits between siblings (e.g. under a filter row, above a chart) and never
   * covers the content it's describing. `top`/`bottom` are ignored when set.
   */
  inline?: boolean;
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
 * screen's own entrance, and persists "seen" to `user_dismissals` on dismiss —
 * so a hint learned on the phone doesn't get re-taught on the web app.
 */
export function CoachMark({ id, text, top, bottom, inline = false, active = true }: CoachMarkProps) {
  const c = useColors();
  const { ready, isDismissed, dismiss } = useDismissals();

  // Nothing renders until the seen-set loads — otherwise the hint flashes in
  // and yanks itself away on every launch.
  if (!ready || !active || isDismissed('coach_mark', id)) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(350).delay(650)}
      exiting={FadeOut.duration(200)}
      style={inline ? styles.wrapInline : [styles.wrap, { top, bottom }]}
      pointerEvents="box-none"
    >
      <View
        // `+ 'EE'` softens the near-black/ecru fill to ~93% so the pill reads as
        // a callout rather than a hard slab over the cream page.
        style={[styles.card, { backgroundColor: c.text + 'EE', borderColor: c.gold, ...cardShadow }]}
        accessibilityRole="alert"
      >
        <Ionicons name="bulb" size={ms(15)} color={c.gold} accessible={false} />
        <ThemedText style={[styles.text, { color: c.background }]}>{text}</ThemedText>
        <TouchableOpacity
          onPress={() => dismiss('coach_mark', id)}
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
  wrapInline: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: s(2),
    marginBottom: s(10),
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
