import { StyleSheet, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, PLAYER_LOCK_OPTIONS, WAIVER_DAY_LABELS, WAIVER_TYPE_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { s } from '@/utils/scale';

interface StepWaiversProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

const DEFAULT_WEEKLY_ADD_LIMIT = 5;

export function StepWaivers({ state, onChange }: StepWaiversProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const weeklyLimitEnabled = state.weeklyAcquisitionLimit != null;
  return (
    <View style={styles.container}>
      <FormSection title="Waiver Wire">
        <FieldGroup label="Waiver Type">
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
          <View style={styles.inlineGroup}>
            <FieldGroup label="FAAB Process Day">
              <SegmentedControl
                options={[...WAIVER_DAY_LABELS]}
                selectedIndex={state.waiverDayOfWeek}
                onSelect={(i) => onChange('waiverDayOfWeek', i)}
              />
            </FieldGroup>

            <NumberStepper
              label="FAAB Budget ($)"
              value={state.faabBudget}
              onValueChange={(v) => onChange('faabBudget', v)}
              min={10}
              max={1000}
              step={10}
              last
            />
          </View>
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
  // AnimatedSection collapses to a single direct child so inside it we
  // need a wrapper with its own gap between the FAAB day + budget
  // fields — FormSection's gap doesn't reach into animated children.
  inlineGroup: {
    gap: s(14),
  },
});
