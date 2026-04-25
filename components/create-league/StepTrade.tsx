import { StyleSheet, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, TRADE_VETO_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';

interface StepTradeProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepTrade({ state, onChange }: StepTradeProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <FormSection title="Trade Review">
        <FieldGroup
          label="Veto Type"
          helperText={
            state.tradeVetoType === 'Commissioner'
              ? 'Only the commissioner can veto trades during the review period.'
              : state.tradeVetoType === 'League Vote'
                ? 'League members can vote to veto. The commissioner can also veto directly.'
                : 'Trades are processed immediately with no review period.'
          }
        >
          <SegmentedControl
            options={TRADE_VETO_OPTIONS}
            selectedIndex={TRADE_VETO_OPTIONS.indexOf(state.tradeVetoType)}
            onSelect={(i) => onChange('tradeVetoType', TRADE_VETO_OPTIONS[i])}
          />
        </FieldGroup>

        <AnimatedSection visible={state.tradeVetoType !== 'None'}>
          <NumberStepper
            label="Review Period (hours)"
            value={state.tradeReviewPeriodHours}
            onValueChange={(v) => onChange('tradeReviewPeriodHours', v)}
            min={1}
            max={72}
            last
          />
        </AnimatedSection>

        <AnimatedSection visible={state.tradeVetoType === 'League Vote'}>
          <NumberStepper
            label="Votes to Veto"
            value={state.tradeVotesToVeto}
            onValueChange={(v) => onChange('tradeVotesToVeto', v)}
            min={1}
            max={Math.max(state.teams - 1, 1)}
            last
          />
        </AnimatedSection>
      </FormSection>

      <FormSection title="Trade Rules">
        <NumberStepper
          label="Trade Deadline (Week)"
          value={state.tradeDeadlineWeek}
          onValueChange={(v) => onChange('tradeDeadlineWeek', v)}
          min={0}
          max={state.regularSeasonWeeks}
          helperText={
            state.tradeDeadlineWeek === 0
              ? 'No trade deadline — trades allowed all season.'
              : `Trades lock after Week ${state.tradeDeadlineWeek}.`
          }
          last={(state.leagueType ?? 'Dynasty') !== 'Dynasty'}
        />

        {(state.leagueType ?? 'Dynasty') === 'Dynasty' && (
          <>
            {/* How far ahead rookie-draft picks are tradeable. Lives in
                Trade Rules (not Rookie Draft) because it's fundamentally
                a trade-mechanic constraint, not a draft-structure
                setting. Renamed from the old "Max Future Draft Years"
                which didn't communicate what the field actually does. */}
            <NumberStepper
              label="Future Rookie Picks"
              value={state.maxDraftYears}
              onValueChange={(v) => onChange('maxDraftYears', v)}
              min={1}
              max={10}
              helperText="Years ahead of the current season that rookie draft picks can be traded."
            />
            <ToggleRow
              icon="shield-checkmark-outline"
              label="Pick Protections & Swaps"
              description="Allow draft pick protections and pick swap rights in trades"
              value={state.pickConditionsEnabled}
              onToggle={(v) => onChange('pickConditionsEnabled', v)}
              c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
              last
            />
          </>
        )}
      </FormSection>

      <FormSection title="Extras">
        <ToggleRow
          icon="megaphone-outline"
          label="League Intel"
          description="Automatically announce when multiple teams are bidding or interested in the same player"
          value={state.autoRumorsEnabled}
          onToggle={(v) => onChange('autoRumorsEnabled', v)}
          c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
        />
      </FormSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
