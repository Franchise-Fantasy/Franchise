import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, DEFAULT_ROSTER_SLOTS, RosterSlot } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface StepRosterProps {
  state: LeagueWizardState;
  onSlotChange: (index: number, count: number) => void;
  onResetRoster: () => void;
}

export function StepRoster({ state, onSlotChange, onResetRoster }: StepRosterProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalSize = state.rosterSlots.reduce((sum, s) => sum + s.count, 0);

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Roster Configuration</ThemedText>
      <ThemedText style={[styles.description, { color: c.secondaryText }]}>
        Set the number of slots for each position.
      </ThemedText>

      {state.rosterSlots.map((slot, index) => (
        <NumberStepper
          key={slot.position}
          label={`${slot.position} - ${slot.label}`}
          value={slot.count}
          onValueChange={(v) => onSlotChange(index, v)}
          min={0}
          max={10}
        />
      ))}

      <View style={[styles.totalRow, { borderTopColor: c.border }]}>
        <ThemedText type="defaultSemiBold">Total Roster Size</ThemedText>
        <ThemedText type="defaultSemiBold">{totalSize}</ThemedText>
      </View>

      <TouchableOpacity onPress={onResetRoster} style={styles.resetBtn}>
        <ThemedText style={{ color: c.accent }}>Reset to Defaults</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    marginBottom: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 2,
    marginTop: 4,
  },
  resetBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
});
