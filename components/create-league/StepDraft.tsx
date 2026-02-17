import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { DRAFT_TYPE_OPTIONS, LeagueWizardState, TIME_PER_PICK_OPTIONS } from '@/constants/LeagueDefaults';
import { StyleSheet, View } from 'react-native';

interface StepDraftProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepDraft({ state, onChange }: StepDraftProps) {
  const timeLabels = TIME_PER_PICK_OPTIONS.map((t) => `${t}s`);

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Draft Settings</ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Draft Type</ThemedText>
        <SegmentedControl
          options={DRAFT_TYPE_OPTIONS}
          selectedIndex={DRAFT_TYPE_OPTIONS.indexOf(state.draftType)}
          onSelect={(i) => onChange('draftType', DRAFT_TYPE_OPTIONS[i])}
        />
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Time Per Pick</ThemedText>
        <SegmentedControl
          options={timeLabels}
          selectedIndex={TIME_PER_PICK_OPTIONS.indexOf(state.timePerPick)}
          onSelect={(i) => onChange('timePerPick', TIME_PER_PICK_OPTIONS[i])}
        />
      </View>

      <View style={styles.section}>
        <NumberStepper
          label="Max Future Draft Years"
          value={state.maxDraftYears}
          onValueChange={(v) => onChange('maxDraftYears', v)}
          min={1}
          max={10}
        />
      </View>
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
