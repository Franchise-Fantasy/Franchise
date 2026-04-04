import { ThemedText } from '@/components/ui/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, NBA_POSITIONS, NbaPosition, PositionLimits, TAXI_EXPERIENCE_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { ms, s } from '@/utils/scale';

interface StepRosterProps {
  state: LeagueWizardState;
  onSlotChange: (index: number, count: number) => void;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
  onResetRoster: () => void;
}

export function StepRoster({ state, onSlotChange, onChange, onResetRoster }: StepRosterProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const posLimitsEnabled = Object.keys(state.positionLimits).length > 0;
  const activeSlots = state.rosterSlots.filter((s) => s.position !== 'IR' && s.position !== 'TAXI');
  const irSlot = state.rosterSlots.find((s) => s.position === 'IR');
  const irIndex = state.rosterSlots.findIndex((s) => s.position === 'IR');
  const taxiSlot = state.rosterSlots.find((s) => s.position === 'TAXI');
  const taxiIndex = state.rosterSlots.findIndex((s) => s.position === 'TAXI');
  const totalSize = activeSlots.reduce((sum, s) => sum + s.count, 0);

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Roster Configuration</ThemedText>
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
        <View style={styles.extraSection}>
          <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.extraHeading}>Injured Reserve</ThemedText>
          <ThemedText style={[styles.extraNote, { color: c.secondaryText }]}>
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

      {taxiSlot !== undefined && taxiIndex !== -1 && (
        <View style={styles.extraSection}>
          <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.extraHeading}>Taxi Squad</ThemedText>
          <ThemedText style={[styles.extraNote, { color: c.secondaryText }]}>
            Taxi squad slots let you stash young players without counting toward the roster total. Taxi players don't score fantasy points.
          </ThemedText>
          <NumberStepper
            label="TAXI - Taxi Squad"
            value={taxiSlot.count}
            onValueChange={(v) => onSlotChange(taxiIndex, v)}
            min={0}
            max={10}
          />
          {taxiSlot.count > 0 && (
            <View style={styles.experienceRow}>
              <ThemedText style={[styles.extraNote, { color: c.secondaryText, marginBottom: s(6) }]}>
                Max player experience for taxi eligibility:
              </ThemedText>
              <View style={styles.experienceOptions}>
                {TAXI_EXPERIENCE_OPTIONS.map((opt) => {
                  const isSelected = state.taxiMaxExperience === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => onChange('taxiMaxExperience', opt.value)}
                      style={[
                        styles.experienceChip,
                        { borderColor: isSelected ? c.accent : c.border, backgroundColor: isSelected ? c.accent + '18' : 'transparent' },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Taxi eligibility: ${opt.label}`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <ThemedText style={[styles.experienceChipText, isSelected && { color: c.accent, fontWeight: '600' }]}>
                        {opt.label}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Position Limits */}
      <View style={styles.extraSection}>
        <View style={styles.posLimitHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.extraHeading}>Position Limits</ThemedText>
            <ThemedText style={[styles.extraNote, { color: c.secondaryText }]}>
              Limit the total number of players at each position across your entire roster.
            </ThemedText>
          </View>
          <Switch
            value={posLimitsEnabled}
            onValueChange={(on) => {
              onChange('positionLimits', on ? { PG: 5, SG: 5, SF: 5, PF: 5, C: 5 } : {});
            }}
            accessibilityLabel="Enable position limits"
          />
        </View>
        {posLimitsEnabled && (
          <>
            <ThemedText style={[styles.extraNote, { color: c.secondaryText, marginBottom: s(4) }]}>
              0 = no limit. Multi-position players count toward each eligible position.
            </ThemedText>
            {NBA_POSITIONS.map((pos) => (
              <NumberStepper
                key={pos}
                label={pos}
                value={state.positionLimits[pos] ?? 0}
                onValueChange={(v) => {
                  const next: PositionLimits = { ...state.positionLimits };
                  if (v === 0) {
                    delete next[pos as NbaPosition];
                  } else {
                    next[pos as NbaPosition] = v;
                  }
                  onChange('positionLimits', next);
                }}
                min={0}
                max={15}
              />
            ))}
          </>
        )}
      </View>

      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reset roster to defaults" onPress={onResetRoster} style={styles.resetBtn}>
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
    marginBottom: s(4),
  },
  description: {
    fontSize: ms(14),
    marginBottom: s(12),
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: s(14),
    borderTopWidth: 2,
    marginTop: s(4),
  },
  resetBtn: {
    alignItems: 'center',
    paddingVertical: s(12),
  },
  extraSection: {
    marginTop: s(16),
  },
  extraHeading: {
    marginBottom: s(4),
  },
  extraNote: {
    fontSize: ms(13),
    marginBottom: s(8),
  },
  experienceRow: {
    marginTop: s(8),
  },
  experienceOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  experienceChip: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 16,
    borderWidth: 1,
  },
  experienceChipText: {
    fontSize: ms(13),
  },
  posLimitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    marginBottom: s(8),
  },
});
