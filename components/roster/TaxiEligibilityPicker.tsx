import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { TAXI_EXPERIENCE_OPTIONS } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface TaxiEligibilityPickerProps {
  /** Max years of pro experience a player may have to be taxi-eligible;
   *  `null` is "No Max". */
  value: number | null;
  onChange: (next: number | null) => void;
  /** Extra line under the chips — used by the commissioner editor to explain
   *  what tightening the rule does to players already stashed on taxi. */
  footnote?: string;
}

/**
 * Taxi-squad eligibility chips, shared by the create-league wizard's roster
 * step and the commissioner's EditRosterModal so the two can't drift on the
 * option set. Callers own the "does this league have taxi slots?" gate — the
 * setting is meaningless at zero slots, and each caller knows its own slot
 * state (wizard state vs. in-progress modal edits).
 */
export function TaxiEligibilityPicker({ value, onChange, footnote }: TaxiEligibilityPickerProps) {
  const c = useColors();

  return (
    <View style={styles.wrap}>
      <ThemedText style={[styles.note, { color: c.secondaryText }]}>
        Max player experience for taxi eligibility:
      </ThemedText>
      {/* radiogroup/radio rather than a set of buttons: these are mutually
          exclusive values, and it matches SegmentedControl, the other
          single-select value picker in the app. */}
      <View
        style={styles.options}
        accessibilityRole="radiogroup"
        accessibilityLabel="Max player experience for taxi eligibility"
      >
        {TAXI_EXPERIENCE_OPTIONS.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <TouchableOpacity
              key={opt.label}
              onPress={() => onChange(opt.value)}
              style={[
                styles.chip,
                {
                  borderColor: isSelected ? c.accent : c.border,
                  backgroundColor: isSelected ? c.accent + '18' : 'transparent',
                },
              ]}
              accessibilityRole="radio"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: isSelected }}
            >
              {/* The selected label deliberately keeps ThemedText's default
                  `text` color rather than tinting to `accent`: accent-on-tint
                  measures 3.05:1 in light and 3.94:1 in dark, under the 4.5:1
                  AA floor for 13px type. Default text is 16:1 / 10.2:1, and
                  selection still reads through the accent border, the tinted
                  fill, and the weight bump — so it never rests on color alone. */}
              <ThemedText style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {opt.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
      {footnote && (
        <ThemedText style={[styles.note, { color: c.secondaryText, marginTop: s(8), marginBottom: 0 }]}>
          {footnote}
        </ThemedText>
      )}
    </View>
  );
}

/** iOS HIG / WCAG 2.5.5 minimum tap target, in points. Deliberately NOT run
 *  through `s()`: that scales with screen width (SCALE = width / 402), so on a
 *  375pt phone `s(44)` is 41 — it would shrink the target below the floor on
 *  exactly the devices where precise tapping is hardest. */
const MIN_TOUCH_TARGET = 44;

const styles = StyleSheet.create({
  wrap: { marginTop: s(8) },
  note: { fontSize: ms(13), marginBottom: s(8) },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8) },
  chip: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    // Centers the label once minHeight makes the chip taller than its text.
    alignItems: 'center',
    justifyContent: 'center',
    // >= half the height, so the taller chip keeps the original capsule shape
    // instead of becoming a rounded rectangle.
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: 1,
  },
  chipText: { fontSize: ms(13) },
  chipTextSelected: { fontWeight: '600' },
});
