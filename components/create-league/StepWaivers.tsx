import { StyleSheet, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors } from '@/constants/Colors';
import {
  FAAB_TIEBREAK_OPTIONS,
  FaabTiebreakOption,
  LeagueWizardState,
  PLAYER_LOCK_OPTIONS,
  WAIVER_PRIORITY_RESET_OPTIONS,
  WAIVER_TYPE_OPTIONS,
  WaiverPriorityResetOption,
  WaiverTypeOption,
} from '@/constants/LeagueDefaults';
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

const FAAB_TIEBREAK_DESCRIPTIONS: Record<FaabTiebreakOption, string> = {
  'Earliest Bid': 'When two teams bid the same amount, the bid placed first wins.',
  'Waiver Priority': 'When two teams bid the same amount, the team with better waiver priority wins.',
};

const WAIVER_PRIORITY_RESET_DESCRIPTIONS: Record<WaiverPriorityResetOption, string> = {
  'Reverse Standings': 'Each new season, waiver priority resets so the worst finisher picks first.',
  'Keep': "Carry the previous season's ending waiver order into the new season.",
  'Random': 'Shuffle waiver priority randomly at the start of each new season.',
};

export function StepWaivers({ state, onChange }: StepWaiversProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const weeklyLimitEnabled = state.weeklyAcquisitionLimit != null;
  // NFL runs ONE weekly waiver clear (Wednesday morning) instead of a rolling
  // per-player timer — football is played once a week and the whole league
  // reacts to the same Sunday. `waiver_until` in the DB owns the rule; the
  // day-count stepper is meaningless here, so it's replaced by the explainer.
  const isNfl = state.sport === 'nfl';
  // Priority order only matters where the resolver reads it: Standard leagues,
  // and FAAB leagues that break equal-bid ties by waiver priority.
  const priorityResetRelevant =
    state.waiverType === 'Standard' ||
    (state.waiverType === 'FAAB' && state.faabTiebreak === 'Waiver Priority');
  const waiverWire = (
    <FormSection key="waiver-wire" title="Waiver Wire">
      <FieldGroup label="Waiver Type" helperText={WAIVER_TYPE_DESCRIPTIONS[state.waiverType]}>
          <SegmentedControl
            options={WAIVER_TYPE_OPTIONS}
            selectedIndex={WAIVER_TYPE_OPTIONS.indexOf(state.waiverType)}
            onSelect={(i) => onChange('waiverType', WAIVER_TYPE_OPTIONS[i])}
          />
        </FieldGroup>

        <AnimatedSection visible={state.waiverType !== 'None'}>
          {isNfl ? (
            <FieldGroup
              label="Waiver Run"
              helperText="Everyone dropped during the week sits on waivers until one weekly run: Wednesday at 5:00 AM ET. That gives the league the Monday and Tuesday after the games to get claims in, and settles the wire before Thursday night kickoff."
            >
              {null}
            </FieldGroup>
          ) : (
            <NumberStepper
              label="Waiver Period (days)"
              value={state.waiverPeriodDays}
              onValueChange={(v) => onChange('waiverPeriodDays', v)}
              min={1}
              max={5}
            />
          )}
        </AnimatedSection>

        <AnimatedSection visible={state.waiverType === 'FAAB'}>
          <NumberStepper
            label="FAAB Budget ($)"
            value={state.faabBudget}
            onValueChange={(v) => onChange('faabBudget', v)}
            min={10}
            max={1000}
            step={10}
            accessibilityLabel="FAAB budget in dollars"
          />
        </AnimatedSection>

        <AnimatedSection visible={state.waiverType === 'FAAB'}>
          <FieldGroup label="Bid Tiebreaker" helperText={FAAB_TIEBREAK_DESCRIPTIONS[state.faabTiebreak]}>
            <SegmentedControl
              options={FAAB_TIEBREAK_OPTIONS}
              selectedIndex={FAAB_TIEBREAK_OPTIONS.indexOf(state.faabTiebreak)}
              onSelect={(i) => onChange('faabTiebreak', FAAB_TIEBREAK_OPTIONS[i])}
            />
          </FieldGroup>
        </AnimatedSection>

        <AnimatedSection visible={priorityResetRelevant}>
          <FieldGroup
            label="Priority Reset (New Season)"
            helperText={WAIVER_PRIORITY_RESET_DESCRIPTIONS[state.waiverPriorityReset]}
          >
            <SegmentedControl
              options={WAIVER_PRIORITY_RESET_OPTIONS}
              selectedIndex={WAIVER_PRIORITY_RESET_OPTIONS.indexOf(state.waiverPriorityReset)}
              onSelect={(i) => onChange('waiverPriorityReset', WAIVER_PRIORITY_RESET_OPTIONS[i])}
            />
          </FieldGroup>
        </AnimatedSection>
    </FormSection>
  );

  const acquisition = (
    <FormSection key="acquisition" title="Acquisition Rules">
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

      {state.sport === 'nfl' ? (
        // NFL has exactly one lock model — each player locks at their game's
        // kickoff and stays locked for the week (the wizard reducer pins
        // playerLockType to Individual). A Daily/Individual picker would be a
        // meaningless choice, so state the rule instead of offering it.
        <FieldGroup
          label="Player Lock"
          helperText="Each player locks at their game's kickoff and stays locked for that week. Players who haven't played yet can be moved all week."
        >
          {null}
        </FieldGroup>
      ) : (
        <FieldGroup
          label="Player Lock"
          helperText={
            state.playerLockType === 'Daily'
              ? 'Once the first game of the day starts, lineups, adds, and drops lock for the day.'
              : 'Lineup changes, adds, and drops for a player lock the moment their game starts.'
          }
        >
          <SegmentedControl
            options={PLAYER_LOCK_OPTIONS}
            selectedIndex={PLAYER_LOCK_OPTIONS.indexOf(state.playerLockType)}
            onSelect={(i) => onChange('playerLockType', PLAYER_LOCK_OPTIONS[i])}
          />
        </FieldGroup>
      )}
    </FormSection>
  );

  return (
    <View style={styles.container}>
      {waiverWire}
      {acquisition}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
