import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LeagueWizardState, WAIVER_DAY_LABELS, WAIVER_TYPE_OPTIONS } from '@/constants/LeagueDefaults';
import { StyleSheet, View } from 'react-native';

interface StepWaiversProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepWaivers({ state, onChange }: StepWaiversProps) {
  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Waiver Settings</ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Waiver Type</ThemedText>
        <SegmentedControl
          options={WAIVER_TYPE_OPTIONS}
          selectedIndex={WAIVER_TYPE_OPTIONS.indexOf(state.waiverType)}
          onSelect={(i) => onChange('waiverType', WAIVER_TYPE_OPTIONS[i])}
        />
      </View>

      {state.waiverType !== 'None' && (
        <View style={styles.section}>
          <NumberStepper
            label="Waiver Period (days)"
            value={state.waiverPeriodDays}
            onValueChange={(v) => onChange('waiverPeriodDays', v)}
            min={1}
            max={5}
          />
        </View>
      )}

      {state.waiverType === 'FAAB' && (
        <>
          <View style={styles.section}>
            <ThemedText style={styles.label}>FAAB Process Day</ThemedText>
            <SegmentedControl
              options={[...WAIVER_DAY_LABELS]}
              selectedIndex={state.waiverDayOfWeek}
              onSelect={(i) => onChange('waiverDayOfWeek', i)}
            />
          </View>

          <View style={styles.section}>
            <NumberStepper
              label="FAAB Budget ($)"
              value={state.faabBudget}
              onValueChange={(v) => onChange('faabBudget', v)}
              min={10}
              max={1000}
              step={10}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 20,
  },
  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
});
