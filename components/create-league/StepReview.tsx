import React from 'react';
import { StyleSheet, View } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, NBA_POSITIONS, SPORT_DISPLAY, WAIVER_DAY_LABELS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { taxiExperienceLabel } from '@/utils/taxiEligibility';

interface StepReviewProps {
  state: LeagueWizardState;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
  /** Label for the primary submit button. Defaults to "Create League". */
  submitLabel?: string;
  /** Optional content rendered above the config Section blocks —
   *  e.g. an import-specific summary card on the Sleeper import flow. */
  headerContent?: React.ReactNode;
}

export function StepReview({
  state,
  onSubmit,
  onBack,
  loading,
  submitLabel = 'Create League',
  headerContent,
}: StepReviewProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalRoster = state.rosterSlots.reduce((sum, s) => sum + s.count, 0);
  const activeSlots = state.rosterSlots.filter((s) => s.count > 0);
  const isDynasty = (state.leagueType ?? 'Dynasty') === 'Dynasty';
  const taxiSlotCount = state.rosterSlots.find((s) => s.position === 'TAXI')?.count ?? 0;

  return (
    <View style={styles.container}>
      {headerContent}
      <Section title="League Basics">
        <Row label="Sport" value={SPORT_DISPLAY[state.sport]} c={c} />
        <Row label="League Type" value={state.leagueType ?? 'Dynasty'} c={c} />
        {state.leagueType === 'Keeper' && (
          <Row label="Keepers Per Team" value={String(state.keeperCount ?? 5)} c={c} />
        )}
        <Row label="Name" value={state.name} c={c} />
        <Row label="Teams" value={String(state.teams)} c={c} />
        <Row label="Visibility" value={state.isPrivate ? 'Private' : 'Public'} c={c} />
        <Row label="Buy-In" value={state.buyIn ? `$${state.buyIn}` : 'Free'} c={c} />
        {state.buyIn > 0 && state.venmoUsername ? <Row label="Venmo" value={`@${state.venmoUsername}`} c={c} /> : null}
        {state.buyIn > 0 && state.cashappTag ? <Row label="Cash App" value={`$${state.cashappTag}`} c={c} /> : null}
        {state.buyIn > 0 && state.paypalUsername ? <Row label="PayPal" value={state.paypalUsername} c={c} /> : null}
      </Section>

      <Section title={`Roster (${totalRoster} slots)`}>
        <ThemedText style={[styles.summaryLine, { color: c.secondaryText }]}>
          {activeSlots.map((s) => `${s.position}: ${s.count}`).join('  |  ')}
        </ThemedText>
        {taxiSlotCount > 0 && (
          <Row label="Taxi Eligibility" value={taxiExperienceLabel(state.taxiMaxExperience)} c={c} />
        )}
        {Object.keys(state.positionLimits).length > 0 && (
          <ThemedText style={[styles.summaryLine, { color: c.secondaryText, marginTop: s(6) }]}>
            Position Limits: {NBA_POSITIONS.filter((p) => state.positionLimits[p] != null).map((p) => `${p}: ${state.positionLimits[p]}`).join('  |  ')}
          </ThemedText>
        )}
      </Section>

      <Section title="Scoring">
        <Row label="Type" value={state.scoringType} c={c} />
        {state.scoringType === 'H2H Categories' ? (
          <ThemedText style={[styles.summaryLine, { color: c.secondaryText }]}>
            {state.categories.filter((cat) => cat.is_enabled).map((cat) => cat.label).join('  |  ')}
            {'\n'}({state.categories.filter((cat) => cat.is_enabled).length} categories)
          </ThemedText>
        ) : (
          <ThemedText style={[styles.summaryLine, { color: c.secondaryText }]}>
            {state.scoring.map((s) => `${s.stat_name}: ${s.point_value > 0 ? '+' : ''}${s.point_value}`).join('  |  ')}
          </ThemedText>
        )}
      </Section>

      <Section title="Draft Settings">
        <Row label="Type" value={state.draftType} c={c} />
        <Row label="Draft Order" value={state.initialDraftOrder} c={c} />
        <Row label="Time Per Pick" value={`${state.timePerPick}s`} c={c} />
        {isDynasty && (
          <>
            <Row label="Future Draft Years" value={String(state.maxDraftYears)} c={c} />
            <Row label="Rookie Draft Rounds" value={String(state.rookieDraftRounds)} c={c} />
            <Row label="Rookie Draft Order" value={state.rookieDraftOrder} c={c} />
            {state.rookieDraftOrder === 'Lottery' && (
              <Row label="Lottery Draws" value={String(state.lotteryDraws)} c={c} />
            )}
            <Row label="Pick Trading" value={state.draftPickTradingEnabled ? 'Enabled' : 'Disabled'} c={c} />
          </>
        )}
      </Section>

      <Section title="Trade Settings">
        <Row label="Veto Type" value={state.tradeVetoType} c={c} />
        {state.tradeVetoType !== 'None' && (
          <Row label="Review Period" value={`${state.tradeReviewPeriodHours} hrs`} c={c} />
        )}
        {state.tradeVetoType === 'League Vote' && (
          <Row label="Votes to Veto" value={String(state.tradeVotesToVeto)} c={c} />
        )}
        {isDynasty && (
          <Row label="Pick Protections & Swaps" value={state.pickConditionsEnabled ? 'Enabled' : 'Disabled'} c={c} />
        )}
        <Row
          label="Trade Deadline"
          value={state.tradeDeadlineWeek === 0 ? 'None' : `After Week ${state.tradeDeadlineWeek}`}
          c={c}
        />
      </Section>

      <Section title="Waiver Settings">
        <Row label="Waiver Type" value={state.waiverType} c={c} />
        {state.waiverType !== 'None' && (
          <Row label="Waiver Period" value={`${state.waiverPeriodDays} days`} c={c} />
        )}
        {state.waiverType === 'FAAB' && (
          <>
            <Row label="Process Day" value={WAIVER_DAY_LABELS[state.waiverDayOfWeek]} c={c} />
            <Row label="FAAB Budget" value={`$${state.faabBudget}`} c={c} />
          </>
        )}
        <Row label="Player Lock" value={state.playerLockType} c={c} />
      </Section>

      <Section title="Season">
        <Row label="NBA Season" value={state.season} c={c} />
        <Row label="Regular Season" value={`${state.regularSeasonWeeks} weeks`} c={c} />
        <Row label="Playoffs" value={`${state.playoffWeeks} weeks`} c={c} />
        <Row label="Playoff Teams" value={String(state.playoffTeams)} c={c} />
        <Row label="Seeding Format" value={state.playoffSeedingFormat} c={c} />
        {state.playoffSeedingFormat === 'Standard' && (
          <Row label="Reseed Each Round" value={state.reseedEachRound ? 'Yes' : 'No'} c={c} />
        )}
        <Row
          label="Divisions"
          value={state.divisionCount === 2 ? `${state.division1Name} & ${state.division2Name}` : 'None'}
          c={c}
        />
      </Section>

      <View style={styles.actionRow}>
        <BrandButton
          label="Back"
          variant="secondary"
          size="default"
          onPress={onBack}
          disabled={loading}
          accessibilityLabel="Back to previous step"
        />
        <BrandButton
          label={submitLabel}
          variant="primary"
          size="default"
          onPress={onSubmit}
          loading={loading}
          accessibilityLabel={submitLabel}
        />
      </View>
    </View>
  );
}

function Row({ label, value, c }: { label: string; value: string; c: any }) {
  return (
    <View style={styles.row}>
      <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <ThemedText style={styles.rowValue} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(5),
    gap: s(12),
  },
  rowLabel: {
    fontSize: ms(14),
    flexShrink: 1,
  },
  rowValue: {
    fontSize: ms(14),
    fontWeight: '500',
    textAlign: 'right',
    flexShrink: 1,
  },
  summaryLine: {
    fontSize: ms(13),
    lineHeight: ms(20),
    paddingVertical: s(4),
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: s(12),
    marginTop: s(8),
    marginBottom: s(20),
  },
});
