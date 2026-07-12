import { Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useBreakpoint } from '@/hooks/useBreakpoint';
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
 * On a phone the segments stretch edge-to-edge, because a full-width bar is
 * the only way to get thumb-sized targets. On desktop that same bar becomes a
 * 600px-wide iOS artifact, so it sizes to its content instead and picks up a
 * hover state — a pointer expects the control to answer when it's over it.
 */
export function SegmentedControl({
  options,
  selectedIndex,
  onSelect,
  accessibilityLabel,
  disabled,
}: SegmentedControlProps) {
  const c = useColors();
  const { isDesktop } = useBreakpoint();

  const bar = [
    styles.bar,
    isDesktop && styles.barDesktop,
    { borderColor: c.border, backgroundColor: c.input },
    disabled && styles.disabled,
  ];

  if (isDesktop) {
    return (
      <View style={bar} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(index)}
              disabled={disabled}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.segment,
                styles.segmentDesktop,
                index > 0 && {
                  borderLeftWidth: StyleSheet.hairlineWidth,
                  borderLeftColor: c.border,
                },
                selected && { backgroundColor: c.primary },
                !selected && hovered ? { backgroundColor: c.cardAlt } : null,
                pressed && { opacity: 0.75 },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={option}
            >
              <ThemedText
                type="varsity"
                style={[styles.label, { color: selected ? Brand.ecru : c.text }]}
                numberOfLines={1}
              >
                {option}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={bar} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
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
  // Shrink-to-fit instead of filling the row.
  barDesktop: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
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
  // NOT `flex: 0` — in Yoga that also sets flexBasis to 0, which collapses the
  // segment to its padding and clips the label under the bar's overflow:hidden.
  // Explicit grow/shrink/basis is the only way to say "size to your content".
  segmentDesktop: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  label: {
    fontSize: ms(11),
    letterSpacing: 0.9,
  },
});
