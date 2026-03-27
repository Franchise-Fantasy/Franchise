import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { LEAGUE_TYPE_DISPLAY, LeagueWizardState, NBA_POSITIONS, WAIVER_DAY_LABELS } from '@/constants/LeagueDefaults';
import { taxiExperienceLabel } from '@/utils/taxiEligibility';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface StepReviewProps {
  state: LeagueWizardState;
  onSubmit: () => void;
  loading: boolean;
}

export function StepReview({ state, onSubmit, loading }: StepReviewProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalRoster = state.rosterSlots.reduce((sum, s) => sum + s.count, 0);
  const activeSlots = state.rosterSlots.filter((s) => s.count > 0);
  const isDynasty = (state.leagueType ?? 'Dynasty') === 'Dynasty';
  const taxiSlotCount = state.rosterSlots.find((s) => s.position === 'TAXI')?.count ?? 0;

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Review & Create</ThemedText>

      {/* Basics */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>League Basics</ThemedText>
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
      </View>

      {/* Roster */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Roster ({totalRoster} slots)</ThemedText>
        <ThemedText style={[styles.rosterSummary, { color: c.secondaryText }]}>
          {activeSlots.map((s) => `${s.position}: ${s.count}`).join('  |  ')}
        </ThemedText>
        {taxiSlotCount > 0 && (
          <Row label="Taxi Eligibility" value={taxiExperienceLabel(state.taxiMaxExperience)} c={c} />
        )}
        {Object.keys(state.positionLimits).length > 0 && (
          <ThemedText style={[styles.rosterSummary, { color: c.secondaryText, marginTop: 4 }]}>
            Position Limits: {NBA_POSITIONS.filter((p) => state.positionLimits[p] != null).map((p) => `${p}: ${state.positionLimits[p]}`).join('  |  ')}
          </ThemedText>
        )}
      </View>

      {/* Scoring */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Scoring</ThemedText>
        <Row label="Type" value={state.scoringType} c={c} />
        {state.scoringType === 'H2H Categories' ? (
          <ThemedText style={[styles.rosterSummary, { color: c.secondaryText }]}>
            {state.categories.filter((cat) => cat.is_enabled).map((cat) => cat.label).join('  |  ')}
            {'\n'}({state.categories.filter((cat) => cat.is_enabled).length} categories)
          </ThemedText>
        ) : (
          <ThemedText style={[styles.rosterSummary, { color: c.secondaryText }]}>
            {state.scoring.map((s) => `${s.stat_name}: ${s.point_value > 0 ? '+' : ''}${s.point_value}`).join('  |  ')}
          </ThemedText>
        )}
      </View>

      {/* Draft */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Draft Settings</ThemedText>
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
            <Row label="Initial Draft, Pick Trading" value={state.draftPickTradingEnabled ? 'Enabled' : 'Disabled'} c={c} />
          </>
        )}
      </View>

      {/* Trade */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Trade Settings</ThemedText>
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
      </View>

      {/* Waivers */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Waiver Settings</ThemedText>
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
      </View>

      {/* Season */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Season</ThemedText>
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
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Create league"
        accessibilityState={{ disabled: loading }}
        onPress={onSubmit}
        disabled={loading}
        style={[styles.createBtn, { backgroundColor: loading ? c.buttonDisabled : c.accent }]}
      >
        {loading ? (
          <ActivityIndicator color={c.accentText} />
        ) : (
          <Text style={[styles.createBtnText, { color: c.accentText }]}>Create League</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function Row({ label, value, c }: { label: string; value: string; c: any }) {
  return (
    <View style={styles.row}>
      <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 16,
  },
  section: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowLabel: {
    fontSize: 14,
  },
  rosterSummary: {
    fontSize: 14,
    lineHeight: 22,
  },
  createBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  createBtnText: {
    fontSize: 17,
    fontWeight: '700',
  },
});
