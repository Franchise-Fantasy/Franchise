import { ToggleRow } from '@/components/ToggleRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, TRADE_VETO_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, View } from 'react-native';
import { ms, s } from '@/utils/scale';

interface StepTradeProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepTrade({ state, onChange }: StepTradeProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Trade Settings</ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Veto Type</ThemedText>
        <SegmentedControl
          options={TRADE_VETO_OPTIONS}
          selectedIndex={TRADE_VETO_OPTIONS.indexOf(state.tradeVetoType)}
          onSelect={(i) => onChange('tradeVetoType', TRADE_VETO_OPTIONS[i])}
        />
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          {state.tradeVetoType === 'Commissioner'
            ? 'Only the commissioner can veto trades during the review period.'
            : state.tradeVetoType === 'League Vote'
              ? 'League members can vote to veto. The commissioner can also veto directly.'
              : 'Trades are processed immediately with no review period.'}
        </ThemedText>
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

      {(state.leagueType ?? 'Dynasty') === 'Dynasty' && (
        <View style={styles.section}>
          <ToggleRow
            icon="shield-checkmark-outline"
            label="Pick Protections & Swaps"
            description="Allow draft pick protections and pick swap rights in trades"
            value={state.pickConditionsEnabled}
            onToggle={(v) => onChange('pickConditionsEnabled', v)}
            c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
          />
        </View>
      )}

      <View style={styles.section}>
        <ToggleRow
          icon="megaphone-outline"
          label="League Intel"
          description="Automatically announce when multiple teams are bidding or interested in the same player"
          value={state.autoRumorsEnabled}
          onToggle={(v) => onChange('autoRumorsEnabled', v)}
          c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
        />
      </View>

      <View style={styles.section}>
        <NumberStepper
          label="Trade Deadline (Week)"
          value={state.tradeDeadlineWeek}
          onValueChange={(v) => onChange('tradeDeadlineWeek', v)}
          min={0}
          max={state.regularSeasonWeeks}
        />
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          {state.tradeDeadlineWeek === 0
            ? 'No trade deadline — trades allowed all season.'
            : `Trades lock after Week ${state.tradeDeadlineWeek}.`}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: s(20),
  },
  label: {
    marginBottom: s(8),
    fontSize: ms(14),
    fontWeight: '500',
  },
  section: {
    marginBottom: s(20),
  },
  hint: {
    fontSize: ms(13),
    marginTop: s(6),
    lineHeight: ms(18),
  },
});
