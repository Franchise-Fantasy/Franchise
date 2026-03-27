import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, View } from 'react-native';

interface ToggleRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  c: { border: string; accent: string; secondaryText: string };
  indented?: boolean;
  last?: boolean;
}

export function ToggleRow({
  icon,
  label,
  description,
  value,
  onToggle,
  disabled = false,
  c,
  indented = false,
  last = false,
}: ToggleRowProps) {
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: c.border, opacity: disabled ? 0.4 : 1 },
        indented && styles.indented,
        last && { borderBottomWidth: 0 },
      ]}
    >
      <View style={styles.left}>
        <Ionicons name={icon} size={20} color={c.secondaryText} accessible={false} />
        <View style={styles.labelWrap}>
          <ThemedText style={styles.label}>{label}</ThemedText>
          {description ? (
            <ThemedText style={[styles.description, { color: c.secondaryText }]}>
              {description}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: c.border, true: c.accent }}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ disabled, checked: value }}
      />
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
  indented: {
    paddingLeft: 30,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 12,
  },
  labelWrap: {
    flex: 1,
  },
  label: {
    fontSize: 16,
  },
  description: {
    fontSize: 12,
    marginTop: 2,
  },
});
