import { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  /** Variant copy: "Trade Sent.", "Added.", "Bid Placed.", etc. */
  label: string;
  /** Auto-dismiss callback fired ~600ms after the overlay shows. */
  onDone: () => void;
  /** Override the default 600ms display duration. */
  durationMs?: number;
}

/**
 * Brief submit confirmation — gold-rule + Alfa Slab card that fades in
 * for ~600ms, then auto-dismisses. Used at every "the action landed"
 * moment (trade sent, free agent added, claim submitted, FAAB bid
 * placed). Motion is a clean opacity fade — the card itself carries the
 * weight, the animation stays out of the way.
 */
export function SubmitOverlay({ visible, label, onDone, durationMs = 600 }: Props) {
  const c = useColors();

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [visible, onDone, durationMs]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.scrim}>
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(160)}
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <View style={[styles.rule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="display"
            style={[styles.label, { color: c.text }]}
            accessibilityLiveRegion="assertive"
          >
            {label}
          </ThemedText>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    paddingHorizontal: s(24),
    paddingVertical: s(18),
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: s(8),
  },
  rule: {
    height: 2,
    width: s(36),
  },
  label: {
    fontSize: ms(22),
    letterSpacing: -0.3,
  },
});
