import { useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import {
  TIME_PER_PICK_MAX,
  TIME_PER_PICK_MIN,
  TIME_PER_PICK_STEP,
} from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { isSlowClock, SLOW_PICK_OPTIONS } from '@/utils/draft/pickClock';
import { ms, s } from '@/utils/scale';

const PACE_OPTIONS = ['Live', 'Slow'] as const;
const DEFAULT_LIVE_SECONDS = 90;
const DEFAULT_SLOW_SECONDS = 28800; // 8 hrs

interface PickClockControlProps {
  /** Pick clock in seconds — a single value covers both paces; the pace is
   *  derived (>= 30 min ⇒ Slow). */
  value: number;
  onValueChange: (seconds: number) => void;
  /** Stepper label in Live mode; also names the control for screen readers. */
  label?: string;
}

/**
 * Live/Slow pick-clock picker shared by the create-league wizard,
 * EditDraftSettingsModal, and CommishDraftControlsSheet. Live keeps the
 * classic seconds stepper (15s–5min); Slow swaps in duration chips
 * (30 min – 1 day) for async "slow drafts" where managers pick on their own
 * schedule and get a reminder push before the clock runs out.
 */
export function PickClockControl({ value, onValueChange, label = 'Time Per Pick' }: PickClockControlProps) {
  const c = useColors();
  const slow = isSlowClock(value);
  // Remember the value each pace last held so toggling away and back restores
  // it instead of resetting to the default. Recorded at switch time (not
  // during render — refs must not be written mid-render).
  const lastLive = useRef(DEFAULT_LIVE_SECONDS);
  const lastSlow = useRef(DEFAULT_SLOW_SECONDS);

  return (
    <View>
      <View style={styles.paceHeader}>
        <ThemedText style={styles.paceLabel}>{label}</ThemedText>
      </View>
      <SegmentedControl
        options={PACE_OPTIONS}
        selectedIndex={slow ? 1 : 0}
        onSelect={(i) => {
          const toSlow = i === 1;
          if (toSlow === slow) return;
          if (slow) lastSlow.current = value;
          else lastLive.current = value;
          onValueChange(toSlow ? lastSlow.current : lastLive.current);
        }}
        accessibilityLabel={`${label} pace`}
      />
      <ThemedText style={[styles.paceHelper, { color: c.secondaryText }]}>
        {slow
          ? 'Slow draft: managers pick on their own schedule. Everyone gets a reminder push before their clock runs out; expired picks autopick.'
          : 'Live draft: everyone drafts together on a short clock.'}
      </ThemedText>

      {slow ? (
        <View
          style={styles.chipWrap}
          accessibilityRole="radiogroup"
          accessibilityLabel={`${label} duration`}
        >
          {SLOW_PICK_OPTIONS.map((opt) => {
            const selected = value === opt.seconds;
            return (
              <TouchableOpacity
                key={opt.seconds}
                onPress={() => onValueChange(opt.seconds)}
                style={[
                  styles.chip,
                  { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary : c.input },
                ]}
                activeOpacity={0.75}
                // Chips are ~30pt tall; pad to the 44pt minimum touch target.
                hitSlop={{ top: s(7), bottom: s(7), left: 0, right: 0 }}
                accessibilityRole="radio"
                // `checked` (not just `selected`) so Android TalkBack announces
                // the chosen chip as selected on the radio node.
                accessibilityState={{ selected, checked: selected }}
                accessibilityLabel={`${opt.label} per pick`}
              >
                <ThemedText
                  type="varsitySmall"
                  style={[styles.chipText, { color: selected ? Brand.ecru : c.text }]}
                >
                  {opt.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <NumberStepper
          label="Seconds"
          accessibilityLabel={`${label} seconds`}
          value={value}
          onValueChange={onValueChange}
          min={TIME_PER_PICK_MIN}
          max={TIME_PER_PICK_MAX}
          step={TIME_PER_PICK_STEP}
          suffix="s"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  paceHeader: {
    paddingTop: s(12),
    paddingBottom: s(8),
  },
  paceLabel: { fontSize: ms(14) },
  paceHelper: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginTop: s(8),
    marginBottom: s(4),
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
    paddingVertical: s(8),
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
});
