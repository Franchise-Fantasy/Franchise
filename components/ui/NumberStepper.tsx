import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

  const atMin = value <= min;
  const atMax = value >= max;

  const decrement = () => {
    const next = Math.round((value - step) * 10) / 10;
    if (next >= min) onValueChange(next);
  };

  const increment = () => {
    const next = Math.round((value + step) * 10) / 10;
    if (next <= max) onValueChange(next);
  };

  const displayValue = step < 1 ? value.toFixed(1) : String(value);

  return (
    <View style={[styles.row, { borderBottomColor: c.border }]}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={decrement}
          disabled={atMin}
          style={[styles.btn, { backgroundColor: atMin ? c.buttonDisabled : c.accent }]}
        >
          <Text style={[styles.btnText, { color: c.accentText }]}>-</Text>
        </TouchableOpacity>
        <Text style={[styles.value, { color: c.text }]}>
          {displayValue}{suffix ?? ''}
        </Text>
        <TouchableOpacity
          onPress={increment}
          disabled={atMax}
          style={[styles.btn, { backgroundColor: atMax ? c.buttonDisabled : c.accent }]}
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 16,
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 20,
    fontWeight: '600',
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'center',
  },
});
