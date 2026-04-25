import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { BrandButton } from '@/components/ui/BrandButton';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors, Fonts } from '@/constants/Colors';
import { LeagueWizardState, NBA_POSITIONS, NbaPosition, PositionLimits, TAXI_EXPERIENCE_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
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

  const posLimitsEnabled = Object.keys(state.positionLimits ?? {}).length > 0;
  const activeSlots = state.rosterSlots.filter((s) => s.position !== 'IR' && s.position !== 'TAXI');
  const irSlot = state.rosterSlots.find((s) => s.position === 'IR');
  const irIndex = state.rosterSlots.findIndex((s) => s.position === 'IR');
  const taxiSlot = state.rosterSlots.find((s) => s.position === 'TAXI');
  const taxiIndex = state.rosterSlots.findIndex((s) => s.position === 'TAXI');
  const totalSize = activeSlots.reduce((sum, s) => sum + s.count, 0);

  return (
    <View style={styles.container}>
      {/* Active Roster Slots */}
      <FormSection title="Starting Lineup & Bench">
        <ThemedText style={[styles.description, { color: c.secondaryText }]}>
          Set the number of slots for each position.
        </ThemedText>

        {activeSlots.map((slot, i) => (
          <NumberStepper
            key={slot.position}
            label={`${slot.position} - ${slot.label}`}
            value={slot.count}
            onValueChange={(v) => onSlotChange(state.rosterSlots.indexOf(slot), v)}
            min={0}
            max={10}
            last={i === activeSlots.length - 1}
          />
        ))}

        <View style={[styles.totalRow, { borderTopColor: c.border }]}>
          <ThemedText
            type="varsitySmall"
            style={[styles.totalLabel, { color: c.secondaryText }]}
          >
            Total Roster Size
          </ThemedText>
          <Text style={[styles.totalValue, { color: c.text }]}>{totalSize}</Text>
        </View>
      </FormSection>

      {/* Special Slots */}
      <FormSection title="Special Slots">
        {irSlot !== undefined && irIndex !== -1 && (
          <View>
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
            <AnimatedSection visible={taxiSlot.count > 0}>
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
            </AnimatedSection>
          </View>
        )}
      </FormSection>

      {/* Position Limits */}
      <FormSection title="Position Limits">
        <ToggleRow
          icon="filter-outline"
          label="Limit players per position"
          description="Cap the total number of players at each position across your roster."
          value={posLimitsEnabled}
          onToggle={(on) => {
            onChange('positionLimits', on ? { PG: 5, SG: 5, SF: 5, PF: 5, C: 5 } : {});
          }}
          c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
          last
        />
        <AnimatedSection visible={posLimitsEnabled}>
          <View style={styles.posLimitList}>
            <ThemedText style={[styles.extraNote, { color: c.secondaryText }]}>
              0 = no limit. Multi-position players count toward each eligible position.
            </ThemedText>
            {NBA_POSITIONS.map((pos, i) => (
              <NumberStepper
                key={pos}
                label={pos}
                value={(state.positionLimits ?? {})[pos] ?? 0}
                onValueChange={(v) => {
                  const next: PositionLimits = { ...(state.positionLimits ?? {}) };
                  if (v === 0) {
                    delete next[pos as NbaPosition];
                  } else {
                    next[pos as NbaPosition] = v;
                  }
                  onChange('positionLimits', next);
                }}
                min={0}
                max={15}
                last={i === NBA_POSITIONS.length - 1}
              />
            ))}
          </View>
        </AnimatedSection>
      </FormSection>

      <View style={styles.resetWrap}>
        <BrandButton
          label="Reset to Defaults"
          variant="ghost"
          size="small"
          onPress={onResetRoster}
          accessibilityLabel="Reset roster to defaults"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  description: {
    fontSize: ms(14),
    marginBottom: s(8),
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalLabel: {
    fontSize: ms(11),
    letterSpacing: 0.9,
  },
  totalValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(16),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resetWrap: {
    alignItems: 'center',
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
  posLimitList: {
    // Animated list of per-position steppers — own gap since it's
    // nested inside AnimatedSection (FormSection's gap doesn't reach
    // through the animated wrapper).
    gap: s(8),
  },
});
