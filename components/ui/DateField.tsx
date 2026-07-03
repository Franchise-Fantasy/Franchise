import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { formatIsoDate, parseLocalDate, toDateStr } from '@/utils/dates';
import { ms, s } from '@/utils/scale';

interface DateFieldProps {
  label: string;
  /** ISO `yyyy-mm-dd`, or null when unset. */
  value: string | null;
  onChange: (iso: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  /** Shown in place of a formatted date when `value` is null. */
  placeholder?: string;
  disabled?: boolean;
  last?: boolean;
}

/**
 * Tappable date row — opens the native Android dialog or an inline iOS
 * spinner (no nested Modal; see CLAUDE.md's modal-stacking note). Shared by
 * any commissioner setting that edits a real calendar date, keeping the
 * platform branching in one place instead of copy-pasted per screen.
 */
export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  placeholder = 'Set date',
  disabled = false,
  last = false,
}: DateFieldProps) {
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';
  const [showPicker, setShowPicker] = useState(false);

  const pickerValue = value ? parseLocalDate(value) : (minimumDate ?? new Date());

  const commit = (date: Date) => {
    date.setHours(0, 0, 0, 0);
    onChange(toDateStr(date));
  };

  const open = () => {
    if (disabled) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: 'date',
        minimumDate,
        maximumDate,
        onChange: (_e: DateTimePickerEvent, date?: Date) => {
          if (date) commit(date);
        },
      });
    } else {
      setShowPicker((v) => !v);
    }
  };

  const displayLabel = value ? formatIsoDate(value) : placeholder;

  return (
    <View>
      <View
        style={[
          styles.row,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
          disabled && { opacity: 0.4 },
        ]}
      >
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
        <TouchableOpacity
          onPress={open}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={
            value ? `${label}: ${displayLabel}. Tap to change.` : `${label} not set. Tap to choose.`
          }
        >
          <ThemedText style={[styles.rowLabel, { color: disabled ? c.secondaryText : c.accent }]}>
            {displayLabel}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'ios' && showPicker && (
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={pickerValue}
            mode="date"
            display="spinner"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_e: DateTimePickerEvent, date?: Date) => {
              if (date) commit(date);
            }}
            textColor={c.text}
            themeVariant={scheme}
            style={styles.picker}
          />
          <BrandButton
            label="Done"
            variant="primary"
            size="default"
            onPress={() => setShowPicker(false)}
            fullWidth
            accessibilityLabel={`Done choosing ${label.toLowerCase()}`}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(12),
  },
  rowLabel: { fontSize: ms(14) },
  pickerWrap: { marginBottom: s(12) },
  picker: { alignSelf: 'center', marginBottom: s(8) },
});
