import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface SegmentedControlProps {
  options: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Accessibility group label — announced by screen readers. */
  accessibilityLabel?: string;
  /** Visually fades and blocks taps. */
  disabled?: boolean;
}

/**
 * Scoreboard-style segmented picker — joined pills with a turfGreen
 * fill on the active segment. Differs from `BrandSegmented` (which is
 * the underline-chyron idiom for tabbed *content selectors*): this one
 * is a *value picker* for forms, where no content flows beneath it, so
 * the segments need button-affordance rather than a subtle underline.
 *
 * Joined visually via a single outer border + per-segment dividers so
 * the group reads as one unit, like a scoreboard toggle.
 */
export function SegmentedControl({
  options,
  selectedIndex,
  onSelect,
  accessibilityLabel,
  disabled,
}: SegmentedControlProps) {
  const c = useColors();

  return (
    <View
      style={[
        styles.bar,
        { borderColor: c.border, backgroundColor: c.input },
        disabled && styles.disabled,
      ]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <TouchableOpacity
            key={option}
            onPress={() => onSelect(index)}
            disabled={disabled}
            style={[
              styles.segment,
              // Left divider on every segment after the first — avoids
              // double borders where they meet.
              index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border },
              selected && { backgroundColor: c.primary },
            ]}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option}
          >
            <ThemedText
              type="varsity"
              style={[
                styles.label,
                { color: selected ? Brand.ecru : c.text },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {option}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.5,
  },
  segment: {
    flex: 1,
    paddingVertical: s(9),
    paddingHorizontal: s(6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: ms(11),
    letterSpacing: 0.9,
  },
});
