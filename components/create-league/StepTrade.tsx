import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { DateField } from '@/components/ui/DateField';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors } from '@/constants/Colors';
import { defaultTradeDeadlineWeek, LeagueWizardState, TRADE_VETO_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { formatIsoDate, parseLocalDate } from '@/utils/dates';
import { defaultSeasonStart, regularSeasonWeekEndDates } from '@/utils/league/seasonWeeks';

interface StepTradeProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepTrade({ state, onChange }: StepTradeProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDynasty = (state.leagueType ?? 'Dynasty') === 'Dynasty';
  const deadlineEnabled = state.tradeDeadlineWeek > 0;

  const seasonStartDate = useMemo(
    () =>
      state.seasonStartDate
        ? parseLocalDate(state.seasonStartDate)
        : defaultSeasonStart(state.sport, state.season),
    [state.seasonStartDate, state.sport, state.season],
  );
  // Regular-season week end dates (merge-window aware) — bounds the
  // "Deadline Date" picker to the actual last day of the regular season, so
  // a custom date can't be dropped into the playoffs.
  const lastWeekEndDate = useMemo(() => {
    const weeks = regularSeasonWeekEndDates(
      state.sport,
      state.season,
      seasonStartDate,
      state.regularSeasonWeeks,
      state.combineCupWeek ?? false,
    );
    return weeks[weeks.length - 1]?.endDate;
  }, [state.sport, state.season, seasonStartDate, state.regularSeasonWeeks, state.combineCupWeek]);

  const review = (
    <FormSection key="trade-review" title="Trade Review">
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
  );

  const rules = (
    <FormSection key="trade-rules" title="Trade Rules">
        <ToggleRow
          icon="calendar-outline"
          label="Trade Deadline"
          description={
            deadlineEnabled && state.tradeDeadlineDate
              ? `Trades lock after ${formatIsoDate(state.tradeDeadlineDate)}.`
              : 'Trades allowed all season.'
          }
          value={deadlineEnabled}
          onToggle={(v) =>
            onChange(
              'tradeDeadlineWeek',
              v ? defaultTradeDeadlineWeek(state.regularSeasonWeeks) : 0,
            )
          }
          c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
          last={!deadlineEnabled && !isDynasty}
        />

        <AnimatedSection visible={deadlineEnabled}>
          <NumberStepper
            label="Deadline Week"
            value={state.tradeDeadlineWeek || 1}
            onValueChange={(v) => onChange('tradeDeadlineWeek', v)}
            min={1}
            max={state.regularSeasonWeeks}
            helperText="Quick-set by week — fine-tune the exact date below."
          />
          <DateField
            label="Deadline Date"
            value={state.tradeDeadlineDate}
            onChange={(iso) => onChange('tradeDeadlineDate', iso)}
            minimumDate={seasonStartDate}
            maximumDate={lastWeekEndDate ? parseLocalDate(lastWeekEndDate) : undefined}
            last={!isDynasty}
          />
        </AnimatedSection>

        {isDynasty && (
          <>
            {/* How far ahead rookie-draft picks are tradeable. Lives in
                Trade Rules (not Rookie Draft) because it's fundamentally
                a trade-mechanic constraint, not a draft-structure
                setting. Renamed from the old "Max Future Draft Years"
                which didn't communicate what the field actually does. */}
            <NumberStepper
              label="Future Rookie Draft Years"
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
  );

  const extras = (
    <FormSection key="extras" title="Extras">
      <ToggleRow
        icon="megaphone-outline"
        label="League Intel"
        description="Automatically announce when multiple teams are bidding or interested in the same player"
        value={state.autoRumorsEnabled}
        onToggle={(v) => onChange('autoRumorsEnabled', v)}
        c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
      />
    </FormSection>
  );

  return (
    <View style={styles.container}>
      {review}
      {rules}
      {extras}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
