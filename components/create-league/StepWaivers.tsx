import { StyleSheet, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, PLAYER_LOCK_OPTIONS, WAIVER_TYPE_OPTIONS, WaiverTypeOption } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';

interface StepWaiversProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

const DEFAULT_WEEKLY_ADD_LIMIT = 5;

// One-line explainer under the Waiver Type picker so commissioners
// understand each option before committing.
const WAIVER_TYPE_DESCRIPTIONS: Record<WaiverTypeOption, string> = {
  Standard:
    'Free agents pass through a waiver period before they can be added, then go to the team with the highest waiver priority.',
  FAAB:
    'Free-Agent Acquisition Budget — each team gets a budget to bid on dropped players while they sit on waivers. When the waiver period ends, the highest bid wins; unclaimed players become free agents.',
  None:
    'No waiver wire. Dropped players and free agents can be picked up instantly, first come first served.',
};

export function StepWaivers({ state, onChange }: StepWaiversProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const weeklyLimitEnabled = state.weeklyAcquisitionLimit != null;
  return (
    <View style={styles.container}>
      <FormSection title="Waiver Wire">
        <FieldGroup label="Waiver Type" helperText={WAIVER_TYPE_DESCRIPTIONS[state.waiverType]}>
          <SegmentedControl
            options={WAIVER_TYPE_OPTIONS}
            selectedIndex={WAIVER_TYPE_OPTIONS.indexOf(state.waiverType)}
            onSelect={(i) => onChange('waiverType', WAIVER_TYPE_OPTIONS[i])}
          />
        </FieldGroup>

        <AnimatedSection visible={state.waiverType !== 'None'}>
          <NumberStepper
            label="Waiver Period (days)"
            value={state.waiverPeriodDays}
            onValueChange={(v) => onChange('waiverPeriodDays', v)}
            min={1}
            max={5}
            last
          />
        </AnimatedSection>

        <AnimatedSection visible={state.waiverType === 'FAAB'}>
          <NumberStepper
            label="FAAB Budget ($)"
            value={state.faabBudget}
            onValueChange={(v) => onChange('faabBudget', v)}
            min={10}
            max={1000}
            step={10}
            last
            accessibilityLabel="FAAB budget in dollars"
          />
        </AnimatedSection>
      </FormSection>

      <FormSection title="Acquisition Rules">
        <ToggleRow
          icon="repeat-outline"
          label="Limit Weekly Adds"
          description={
            weeklyLimitEnabled
              ? `Each team can add up to ${state.weeklyAcquisitionLimit} player${state.weeklyAcquisitionLimit === 1 ? '' : 's'} per week.`
              : 'Teams can add as many players as they want each week.'
          }
          value={weeklyLimitEnabled}
          onToggle={(v) => onChange('weeklyAcquisitionLimit', v ? DEFAULT_WEEKLY_ADD_LIMIT : null)}
          c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
        />

        <AnimatedSection visible={weeklyLimitEnabled}>
          <NumberStepper
            label="Adds Per Week"
            value={state.weeklyAcquisitionLimit ?? DEFAULT_WEEKLY_ADD_LIMIT}
            onValueChange={(v) => onChange('weeklyAcquisitionLimit', v)}
            min={1}
            max={20}
            last
          />
        </AnimatedSection>

        <FieldGroup
          label="Player Lock"
          helperText={
            state.playerLockType === 'Daily'
              ? 'Once the first game of the day tips off, lineups, adds, and drops lock for the day.'
              : 'Lineup changes, adds, and drops for a player lock the moment their game tips off.'
          }
        >
          <SegmentedControl
            options={PLAYER_LOCK_OPTIONS}
            selectedIndex={PLAYER_LOCK_OPTIONS.indexOf(state.playerLockType)}
            onSelect={(i) => onChange('playerLockType', PLAYER_LOCK_OPTIONS[i])}
          />
        </FieldGroup>
      </FormSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
