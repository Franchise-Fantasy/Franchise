import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LeagueWizardState, TRADE_VETO_OPTIONS } from '@/constants/LeagueDefaults';
import { StyleSheet, View } from 'react-native';

interface StepTradeProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepTrade({ state, onChange }: StepTradeProps) {
  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Trade Settings</ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Veto Type</ThemedText>
        <SegmentedControl
          options={TRADE_VETO_OPTIONS}
          selectedIndex={TRADE_VETO_OPTIONS.indexOf(state.tradeVetoType)}
          onSelect={(i) => onChange('tradeVetoType', TRADE_VETO_OPTIONS[i])}
        />
      </View>

      {state.tradeVetoType !== 'None' && (
        <View style={styles.section}>
          <NumberStepper
            label="Review Period (hours)"
            value={state.tradeReviewPeriodHours}
            onValueChange={(v) => onChange('tradeReviewPeriodHours', v)}
            min={1}
            max={72}
          />
        </View>
      )}

      {state.tradeVetoType === 'League Vote' && (
        <View style={styles.section}>
          <NumberStepper
            label="Votes to Veto"
            value={state.tradeVotesToVeto}
            onValueChange={(v) => onChange('tradeVotesToVeto', v)}
            min={1}
            max={Math.max(state.teams - 1, 1)}
          />
        </View>
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
