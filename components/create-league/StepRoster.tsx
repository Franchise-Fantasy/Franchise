import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState } from '@/constants/LeagueDefaults';
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

  const activeSlots = state.rosterSlots.filter((s) => s.position !== 'IR');
  const irSlot = state.rosterSlots.find((s) => s.position === 'IR');
  const irIndex = state.rosterSlots.findIndex((s) => s.position === 'IR');
  const totalSize = activeSlots.reduce((sum, s) => sum + s.count, 0);

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Roster Configuration</ThemedText>
      <ThemedText style={[styles.description, { color: c.secondaryText }]}>
        Set the number of slots for each position.
      </ThemedText>

      {activeSlots.map((slot) => (
        <NumberStepper
          key={slot.position}
          label={`${slot.position} - ${slot.label}`}
          value={slot.count}
          onValueChange={(v) => onSlotChange(state.rosterSlots.indexOf(slot), v)}
          min={0}
          max={10}
        />
      ))}

      <View style={[styles.totalRow, { borderTopColor: c.border }]}>
        <ThemedText type="defaultSemiBold">Total Roster Size</ThemedText>
        <ThemedText type="defaultSemiBold">{totalSize}</ThemedText>
      </View>

      {irSlot !== undefined && irIndex !== -1 && (
        <View style={styles.irSection}>
          <ThemedText type="defaultSemiBold" style={styles.irHeading}>Injured Reserve</ThemedText>
          <ThemedText style={[styles.irNote, { color: c.secondaryText }]}>
            IR slots are extra capacity and do not count toward the roster total. Only players with an OUT designation can be placed here.
          </ThemedText>
          <NumberStepper
            label="IR - Injured Reserve"
            value={irSlot.count}
            onValueChange={(v) => onSlotChange(irIndex, v)}
            min={0}
            max={5}
          />
        </View>
      )}

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
  irSection: {
    marginTop: 16,
  },
  irHeading: {
    marginBottom: 4,
  },
  irNote: {
    fontSize: 13,
    marginBottom: 8,
  },
});
