import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { formatMinuteOfDay } from '@/utils/draft/quietHours';
import { ms, s } from '@/utils/scale';

/** Sensible overnight defaults (ET) applied the first time quiet hours is
 *  switched on: pause 3:00 AM, resume 8:00 AM. Exported so callers can seed
 *  their own state without re-deriving the numbers. */
export const DEFAULT_QUIET_START_MIN = 180; // 3:00 AM
export const DEFAULT_QUIET_END_MIN = 480; // 8:00 AM

// Minute-of-day presets. Overnight windows only — enough coverage without a
// full time picker. Start = when the clock freezes; Resume = when it wakes.
const START_OPTIONS = [1260, 1320, 1380, 0, 60, 120, 180]; // 9pm–3am
const RESUME_OPTIONS = [300, 360, 420, 480, 540, 600]; // 5am–10am

export interface QuietHoursValue {
  enabled: boolean;
  /** Minute-of-day (ET) the clock freezes / wakes. */
  startMin: number;
  endMin: number;
}

interface QuietHoursControlProps {
  value: QuietHoursValue;
  onChange: (next: QuietHoursValue) => void;
}

/**
 * Overnight "quiet hours" picker for SLOW (async) drafts — the callers already
 * hide it for live clocks. Enabling freezes the pick clock nightly between the
 * chosen times (ET) so nobody lands on the clock and gets auto-drafted at 3am;
 * it resumes when the window closes. Shared by the create-league wizard,
 * EditDraftSettingsModal, and the in-draft CommishDraftControlsSheet.
 */
export function QuietHoursControl({ value, onChange }: QuietHoursControlProps) {
  const c = useColors();
  const { enabled, startMin, endMin } = value;

  return (
    <View>
      <ToggleRow
        icon="moon-outline"
        label="Overnight Quiet Hours"
        description={
          enabled
            ? `Clock freezes ${formatMinuteOfDay(startMin)}–${formatMinuteOfDay(endMin)} ET — nobody is auto-drafted overnight.`
            : 'Freeze the pick clock overnight so nobody is auto-drafted while they sleep.'
        }
        value={enabled}
        onToggle={(on) => onChange({ ...value, enabled: on })}
        c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
      />

      {enabled && (
        <>
          <ChipRow
            label="Freeze At"
            selected={startMin}
            options={START_OPTIONS}
            onSelect={(min) => onChange({ ...value, startMin: min })}
          />
          <ChipRow
            label="Resume At"
            selected={endMin}
            options={RESUME_OPTIONS}
            onSelect={(min) => onChange({ ...value, endMin: min })}
          />
          <ThemedText style={[styles.helper, { color: c.secondaryText }]}>
            Times are Eastern (ET). Eager managers can still pick during quiet
            hours — the clock just won&apos;t run out on anyone.
          </ThemedText>
        </>
      )}
    </View>
  );
}

interface ChipRowProps {
  label: string;
  selected: number;
  options: number[];
  onSelect: (min: number) => void;
}

function ChipRow({ label, selected, options, onSelect }: ChipRowProps) {
  const c = useColors();
  return (
    <View style={styles.rowWrap}>
      <ThemedText type="varsitySmall" style={[styles.rowLabel, { color: c.secondaryText }]}>
        {label}
      </ThemedText>
      <View
        style={styles.chipWrap}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((min) => {
          const isSel = selected === min;
          return (
            <TouchableOpacity
              key={min}
              onPress={() => onSelect(min)}
              style={[
                styles.chip,
                { borderColor: isSel ? c.primary : c.border, backgroundColor: isSel ? c.primary : c.input },
              ]}
              activeOpacity={0.75}
              // Chips are ~30pt tall; pad to the 44pt minimum touch target.
              hitSlop={{ top: s(7), bottom: s(7), left: 0, right: 0 }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSel, checked: isSel }}
              accessibilityLabel={`${label} ${formatMinuteOfDay(min)}`}
            >
              <ThemedText
                type="varsitySmall"
                style={[styles.chipText, { color: isSel ? Brand.ecru : c.text }]}
              >
                {formatMinuteOfDay(min)}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: { paddingTop: s(10) },
  rowLabel: { fontSize: ms(10), marginBottom: s(4) },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
    paddingVertical: s(4),
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: s(12),
    paddingVertical: s(7),
  },
  chipText: {
    fontSize: ms(11),
    letterSpacing: 0.9,
  },
  helper: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginTop: s(8),
    marginBottom: s(4),
  },
});
