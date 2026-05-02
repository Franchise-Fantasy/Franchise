import { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  /** Variant copy: "Trade Sent." / "Counteroffer Sent." / "Locked In." */
  label: string;
  /** Auto-dismiss callback fired ~500ms after the overlay shows. */
  onDone: () => void;
}

/**
 * Half-second weighty submit confirmation — gold-rule + Alfa Slab
 * "Trade Sent." card that ZoomIns on success, then dismisses. Replaces
 * the silent close-and-toast UX so the submit lands with a moment.
 */
export function TradeSubmitOverlay({ visible, label, onDone }: Props) {
  const c = useColors();

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDone, 600);
    return () => clearTimeout(t);
  }, [visible, onDone]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.scrim}>
        <Animated.View
          entering={ZoomIn.springify().damping(14)}
          exiting={ZoomOut.duration(180)}
          style={[styles.card, { backgroundColor: c.card, borderColor: c.gold }]}
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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    paddingHorizontal: s(28),
    paddingVertical: s(22),
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    gap: s(10),
  },
  rule: {
    height: 3,
    width: s(48),
  },
  label: {
    fontSize: ms(28),
    letterSpacing: -0.3,
  },
});
