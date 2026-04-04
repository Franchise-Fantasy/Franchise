import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface NumberStepperProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

export function NumberStepper({
  label,
  value,
  onValueChange,
  min = 0,
  max = 99,
  step = 1,
  suffix,
}: NumberStepperProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const atMin = value <= min;
  const atMax = value >= max;

  const decrement = () => {
    const next = Math.round((value - step) * 100) / 100;
    if (next >= min) onValueChange(next);
  };

  const increment = () => {
    const next = Math.round((value + step) * 100) / 100;
    if (next <= max) onValueChange(next);
  };

  const displayValue = step < 1
    ? (value % 1 === 0 ? value.toFixed(1) : String(parseFloat(value.toFixed(2))))
    : String(value);

  const startEditing = () => {
    setDraft(displayValue);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (isNaN(parsed)) return;
    const clamped = Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
    onValueChange(clamped);
  };

  return (
    <View style={[styles.row, { borderBottomColor: c.border }]}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={decrement}
          disabled={atMin}
          style={[styles.btn, { backgroundColor: atMin ? c.buttonDisabled : c.accent }]}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          accessibilityState={{ disabled: atMin }}
        >
          <Text style={[styles.btnText, { color: c.accentText }]}>-</Text>
        </TouchableOpacity>
        {editing ? (
          <TextInput
            style={[styles.value, styles.valueBox, { color: c.text, borderColor: c.accent }]}
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
            style={[styles.valueBox, { borderColor: c.border }]}
            accessibilityRole="adjustable"
            accessibilityLabel={`${label}, ${displayValue}${suffix ?? ''}`}
            accessibilityHint="Double tap to edit"
          >
            <Text style={[styles.value, { color: c.text }]}>
              {displayValue}{suffix ?? ''}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={increment}
          disabled={atMax}
          style={[styles.btn, { backgroundColor: atMax ? c.buttonDisabled : c.accent }]}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          accessibilityState={{ disabled: atMax }}
        >
          <Text style={[styles.btnText, { color: c.accentText }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: ms(16),
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  btn: {
    width: s(36),
    height: s(36),
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: ms(20),
    fontWeight: '600',
  },
  value: {
    fontSize: ms(16),
    fontWeight: '600',
    textAlign: 'center',
  },
  valueBox: {
    minWidth: s(52),
    paddingHorizontal: s(6),
    height: s(32),
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
