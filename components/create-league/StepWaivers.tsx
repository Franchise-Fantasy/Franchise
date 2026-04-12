import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { FormSection } from '@/components/ui/FormSection';
import { ThemedText } from '@/components/ui/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LeagueWizardState, PLAYER_LOCK_OPTIONS, WAIVER_DAY_LABELS, WAIVER_TYPE_OPTIONS } from '@/constants/LeagueDefaults';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, View } from 'react-native';
import { ms, s } from '@/utils/scale';

interface StepWaiversProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepWaivers({ state, onChange }: StepWaiversProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Waiver Settings</ThemedText>

      <FormSection title="Waiver Wire">
        <ThemedText style={styles.label}>Waiver Type</ThemedText>
        <SegmentedControl
          options={WAIVER_TYPE_OPTIONS}
          selectedIndex={WAIVER_TYPE_OPTIONS.indexOf(state.waiverType)}
          onSelect={(i) => onChange('waiverType', WAIVER_TYPE_OPTIONS[i])}
        />

        <AnimatedSection visible={state.waiverType !== 'None'}>
          <View style={styles.fieldGap}>
            <NumberStepper
              label="Waiver Period (days)"
              value={state.waiverPeriodDays}
              onValueChange={(v) => onChange('waiverPeriodDays', v)}
              min={1}
              max={5}
            />
          </View>
        </AnimatedSection>

        <AnimatedSection visible={state.waiverType === 'FAAB'}>
          <View style={styles.fieldGap}>
            <ThemedText style={styles.label}>FAAB Process Day</ThemedText>
            <SegmentedControl
              options={[...WAIVER_DAY_LABELS]}
              selectedIndex={state.waiverDayOfWeek}
              onSelect={(i) => onChange('waiverDayOfWeek', i)}
            />
          </View>

          <View style={styles.fieldGap}>
            <NumberStepper
              label="FAAB Budget ($)"
              value={state.faabBudget}
              onValueChange={(v) => onChange('faabBudget', v)}
              min={10}
              max={1000}
              step={10}
            />
          </View>
        </AnimatedSection>
      </FormSection>

      <FormSection title="Acquisition Rules">
        <NumberStepper
          label="Weekly Add Limit"
          value={state.weeklyAcquisitionLimit ?? 0}
          onValueChange={(v) => onChange('weeklyAcquisitionLimit', v === 0 ? null : v)}
          min={0}
          max={20}
        />
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          {state.weeklyAcquisitionLimit ? `Max ${state.weeklyAcquisitionLimit} adds per week` : 'Unlimited adds per week'}
        </ThemedText>

        <View style={styles.fieldGap}>
          <ThemedText style={styles.label}>Player Lock</ThemedText>
          <SegmentedControl
            options={PLAYER_LOCK_OPTIONS}
            selectedIndex={PLAYER_LOCK_OPTIONS.indexOf(state.playerLockType)}
            onSelect={(i) => onChange('playerLockType', PLAYER_LOCK_OPTIONS[i])}
          />
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            {state.playerLockType === 'Daily'
              ? 'Once the first NBA game starts each day, adds process the next day'
              : 'Players whose games have started cannot be added or dropped'}
          </ThemedText>
        </View>
      </FormSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: s(16),
  },
  label: {
    marginBottom: s(8),
    fontSize: ms(14),
    fontWeight: '500',
  },
  hint: {
    fontSize: ms(12),
    marginTop: s(4),
    opacity: 0.7,
  },
  fieldGap: {
    marginTop: s(12),
  },
});
