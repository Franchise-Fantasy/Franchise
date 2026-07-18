import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import { AppTextInput } from './AppTextInput';
import { SheetRow, useFormSheet } from './formSheet';
import { ThemedText } from './ThemedText';

interface NumberStepperProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Optional accessibility label override — defaults to the visible label. */
  accessibilityLabel?: string;
  /** When true, drops the bottom hairline — use on the last row in a list
   *  (inside a FormSection or AnimatedSection) so the list doesn't read
   *  as "there should be more content below." */
  last?: boolean;
  /** Muted explainer text under the row — short usage hint, matches the
   *  helperText slot on `BrandTextInput` and `FieldGroup`. */
  helperText?: string;
}

/**
 * Numeric field with two very different personalities:
 *
 * **Native / phone** — a scoreboard stepper: varsity label left, outlined −/+
 * buttons flanking a monospaced readout right. Tap the value to type. Unchanged.
 *
 * **Desktop web (inside a charter sheet)** — a typed field. The −/+ stepper only
 * exists because a phone has no keyboard; on a desktop the fastest way to set
 * "12 teams" is to type 12. So the value IS the input: click and type, ↑/↓ nudge
 * it, and small chevrons cover the mouse-only case. The valid range sits beside
 * it in mono so you know the bounds without discovering them by being blocked.
 */
export function NumberStepper({
  label,
  value,
  onValueChange,
  min = 0,
  max = 99,
  step = 1,
  suffix,
  accessibilityLabel,
  last = false,
  helperText,
}: NumberStepperProps) {
  const a11yBase = accessibilityLabel ?? label;
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const inSheet = useFormSheet();
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const atMin = value <= min;
  const atMax = value >= max;

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100));

  const decrement = () => {
    const next = Math.round((value - step) * 100) / 100;
    if (next >= min) onValueChange(next);
  };

  const increment = () => {
    const next = Math.round((value + step) * 100) / 100;
    if (next <= max) onValueChange(next);
  };

  const displayValue =
    step < 1
      ? value % 1 === 0
        ? value.toFixed(1)
        : String(parseFloat(value.toFixed(2)))
      : String(value);

  const startEditing = () => {
    setDraft(displayValue);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (isNaN(parsed)) return;
    onValueChange(clamp(parsed));
  };

  // ─── Desktop charter sheet: typed field ───────────────────────────
  if (inSheet) {
    // Keep the visible draft in step with arrow-key/chevron nudges so the field
    // doesn't show a stale string while focused.
    const bump = (direction: 1 | -1) => {
      const next = clamp(value + direction * step);
      if (next === value) return;
      onValueChange(next);
      setDraft(
        step < 1 ? (next % 1 === 0 ? next.toFixed(1) : String(parseFloat(next.toFixed(2)))) : String(next),
      );
    };

    const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      if (key === 'ArrowUp') bump(1);
      else if (key === 'ArrowDown') bump(-1);
    };

    return (
      <SheetRow label={label} helper={helperText} last={last}>
        <View style={sheet.row}>
          <View
            style={[
              sheet.box,
              { backgroundColor: c.input, borderColor: focused ? c.accent : c.border },
            ]}
          >
            <AppTextInput
              value={editing ? draft : `${displayValue}${suffix ?? ''}`}
              onChangeText={setDraft}
              onFocus={() => {
                setFocused(true);
                startEditing();
              }}
              onBlur={() => {
                setFocused(false);
                commitEdit();
              }}
              onSubmitEditing={commitEdit}
              onKeyPress={onKeyPress}
              inputMode="numeric"
              selectTextOnFocus
              style={[sheet.input, { color: c.text }]}
              accessibilityLabel={`${a11yBase}, ${displayValue}${suffix ?? ''}`}
            />
            <View style={[sheet.spinner, { borderLeftColor: c.border }]}>
              <Pressable
                onPress={() => bump(1)}
                disabled={atMax}
                style={({ hovered }: { hovered?: boolean }) => [
                  sheet.spinBtn,
                  hovered && !atMax ? { backgroundColor: c.cardAlt } : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Increase ${a11yBase}`}
                accessibilityState={{ disabled: atMax }}
              >
                <Ionicons name="chevron-up" size={11} color={atMax ? c.border : c.secondaryText} />
              </Pressable>
              <Pressable
                onPress={() => bump(-1)}
                disabled={atMin}
                style={({ hovered }: { hovered?: boolean }) => [
                  sheet.spinBtn,
                  hovered && !atMin ? { backgroundColor: c.cardAlt } : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${a11yBase}`}
                accessibilityState={{ disabled: atMin }}
              >
                <Ionicons name="chevron-down" size={11} color={atMin ? c.border : c.secondaryText} />
              </Pressable>
            </View>
          </View>
          <ThemedText style={[sheet.range, { color: c.secondaryText }]}>
            {min}–{max}
          </ThemedText>
        </View>
      </SheetRow>
    );
  }

  // ─── Native / phone: scoreboard stepper ───────────────────────────
  return (
    <View
      style={[
        styles.wrap,
        { borderBottomColor: c.border },
        last && styles.rowLast,
      ]}
    >
    <View style={styles.row}>
      <ThemedText
        type="varsitySmall"
        style={[styles.label, { color: c.secondaryText }]}
        numberOfLines={2}
      >
        {label}
      </ThemedText>

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={decrement}
          disabled={atMin}
          style={[
            styles.btn,
            { borderColor: atMin ? c.border : c.text },
            atMin && styles.btnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${a11yBase}`}
          accessibilityState={{ disabled: atMin }}
        >
          <Text style={[styles.btnText, { color: atMin ? c.secondaryText : c.text }]}>−</Text>
        </TouchableOpacity>

        {editing ? (
          <AppTextInput
            style={[
              styles.valueBox,
              styles.valueText,
              { color: c.text, borderColor: c.accent, backgroundColor: c.input },
            ]}
            value={draft}
            onChangeText={setDraft}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            keyboardType="numeric"
            autoFocus
            selectTextOnFocus
            accessibilityLabel={`Edit ${label}`}
          />
        ) : (
          <TouchableOpacity
            onPress={startEditing}
            style={[styles.valueBox, { borderColor: c.border, backgroundColor: c.input }]}
            accessibilityRole="adjustable"
            accessibilityLabel={`${label}, ${displayValue}${suffix ?? ''}`}
            accessibilityHint="Double tap to edit"
          >
            <Text style={[styles.valueText, { color: c.text }]} numberOfLines={1}>
              {displayValue}
              {suffix ?? ''}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={increment}
          disabled={atMax}
          style={[
            styles.btn,
            { borderColor: atMax ? c.border : c.text },
            atMax && styles.btnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${a11yBase}`}
          accessibilityState={{ disabled: atMax }}
        >
          <Text style={[styles.btnText, { color: atMax ? c.secondaryText : c.text }]}>+</Text>
        </TouchableOpacity>
      </View>
      </View>
      {helperText && (
        <ThemedText style={[styles.helper, { color: c.secondaryText }]}>
          {helperText}
        </ThemedText>
      )}
    </View>
  );
}

// Desktop charter-sheet field.
const sheet = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: 116,
    height: 36,
    borderWidth: 1.5,
    borderRadius: 8,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingHorizontal: 11,
    fontFamily: Fonts.mono,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  spinner: { width: 24, borderLeftWidth: StyleSheet.hairlineWidth },
  spinBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  range: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 0.4 },
});

const styles = StyleSheet.create({
  // Outer wrapper owns the hairline divider so the helperText sits
  // above it (aligned with where the next row would begin). The
  // `paddingBottom` here has to roughly balance against FormSection's
  // `gap: 14` that applies *below* the hairline (between this
  // stepper's bottom edge and the next stepper's top edge) — without
  // it, content hugs the hairline on top while there's plenty of air
  // below, which reads as asymmetric.
  wrap: {
    paddingTop: s(2),
    paddingBottom: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(12),
  },
  helper: {
    fontSize: ms(11),
    lineHeight: ms(15),
    marginTop: s(4),
  },
  label: {
    flex: 1,
    fontSize: ms(10),
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  // Outlined stepper buttons — compact squares instead of the
  // accent-filled circles so they read as neutral scoreboard chrome
  // and the value itself holds visual weight.
  btn: {
    width: s(28),
    height: s(28),
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    fontSize: ms(16),
    fontWeight: '600',
    lineHeight: ms(18),
    ...Platform.select({ android: { includeFontPadding: false } }),
  },
  valueBox: {
    minWidth: s(54),
    height: s(28),
    paddingHorizontal: s(8),
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
