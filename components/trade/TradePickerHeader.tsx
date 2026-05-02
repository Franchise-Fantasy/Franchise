import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface TradePickerHeaderProps {
  /** Gold-rule eyebrow ("Players" / "Picks" / "Pick Swap"). */
  eyebrow: string;
  /** Alfa Slab title — usually the team being picked from. */
  title: string;
  /** Right-aligned dismiss CTA ("Done" by default, "Cancel" for the swap picker). */
  doneLabel?: string;
  onBack: () => void;
}

/**
 * Shared header for the fullscreen asset pickers (player / pick / swap).
 * Back chevron on the left, gold-rule eyebrow + title in the middle,
 * trailing Done/Cancel button on the right. Matches the brand chrome
 * used across the rest of the trade surface.
 */
export function TradePickerHeader({
  eyebrow,
  title,
  doneLabel = 'Done',
  onBack,
}: TradePickerHeaderProps) {
  const c = useColors();
  return (
    <View style={[styles.row, { borderBottomColor: c.border }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.back}
      >
        <Ionicons name="chevron-back" size={22} color={c.text} />
      </TouchableOpacity>

      <View style={styles.titleBlock}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.rule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrow, { color: c.gold }]}
            numberOfLines={1}
          >
            {eyebrow}
          </ThemedText>
        </View>
        <ThemedText
          accessibilityRole="header"
          type="defaultSemiBold"
          style={[styles.title, { color: c.text }]}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={doneLabel}
        onPress={onBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.done}
      >
        <ThemedText
          type="varsitySmall"
          style={[styles.doneText, { color: c.gold }]}
        >
          {doneLabel}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  back: { padding: s(2) },
  titleBlock: {
    flex: 1,
    gap: s(2),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  rule: { height: 2, width: s(12) },
  eyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  title: { fontSize: ms(16) },
  done: { padding: s(2) },
  doneText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
});
