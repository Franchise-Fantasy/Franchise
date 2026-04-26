import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

interface BrandSegmentedProps<T extends string> {
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  /**
   * Drop the hairline baseline that runs across the bottom of the bar.
   * Default `false`. The baseline ties the chyron to content directly
   * underneath (Legal tabs → document body); pages where the segmented
   * sits in isolation (Auth) read better without it.
   */
  noBaseline?: boolean;
}

/**
 * Brand-styled segmented switcher. Scoreboard-inspired tab row:
 * Oswald varsity caps labels with a Turf Green underline on the active
 * tab, sitting over a hairline baseline. Reads as a broadcast chyron
 * rather than a generic iOS pill, matching the deck's 1980s aesthetic.
 *
 * Tabs distribute evenly via `flex: 1` — the indicator under the active
 * tab spans that slot's full width. `adjustsFontSizeToFit` guards
 * against long labels on narrow phones.
 */
export function BrandSegmented<T extends string>({
  options,
  selected,
  onSelect,
  noBaseline = false,
}: BrandSegmentedProps<T>) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View
      style={[
        styles.bar,
        noBaseline
          ? { borderBottomWidth: 0 }
          : { borderBottomColor: c.border },
      ]}
    >
      {options.map((opt) => {
        const isSelected = opt === selected;
        return (
          <TouchableOpacity
            key={opt}
            style={styles.tab}
            onPress={() => onSelect(opt)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={opt}
          >
            <ThemedText
              type="varsity"
              style={[
                styles.label,
                { color: isSelected ? c.text : c.secondaryText },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {opt}
            </ThemedText>
            <View
              style={[
                styles.indicator,
                isSelected && { backgroundColor: Brand.turfGreen },
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: s(14),
  },
  tab: {
    flex: 1,
    paddingTop: s(10),
    paddingBottom: s(8),
    alignItems: 'center',
  },
  label: {
    fontSize: ms(11),
    letterSpacing: 0.9,
    paddingHorizontal: s(2),
  },
  // Active indicator — Turf Green bar beneath the label, overlapping
  // the bar's bottom hairline. Height 2 so it reads as a deliberate
  // underline, not a box edge.
  indicator: {
    marginTop: s(6),
    height: 2,
    width: '100%',
    backgroundColor: 'transparent',
  },
});
