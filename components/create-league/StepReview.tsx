import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState } from '@/constants/LeagueDefaults';
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

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Review & Create</ThemedText>

      {/* Basics */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>League Basics</ThemedText>
        <Row label="Name" value={state.name} c={c} />
        <Row label="Teams" value={String(state.teams)} c={c} />
        <Row label="Visibility" value={state.isPrivate ? 'Private' : 'Public'} c={c} />
      </View>

      {/* Roster */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Roster ({totalRoster} slots)</ThemedText>
        <ThemedText style={[styles.rosterSummary, { color: c.secondaryText }]}>
          {activeSlots.map((s) => `${s.position}: ${s.count}`).join('  |  ')}
        </ThemedText>
      </View>

      {/* Scoring */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Scoring</ThemedText>
        <ThemedText style={[styles.rosterSummary, { color: c.secondaryText }]}>
          {state.scoring.map((s) => `${s.stat_name}: ${s.point_value > 0 ? '+' : ''}${s.point_value}`).join('  |  ')}
        </ThemedText>
      </View>

      {/* Draft */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Draft Settings</ThemedText>
        <Row label="Type" value={state.draftType} c={c} />
        <Row label="Time Per Pick" value={`${state.timePerPick}s`} c={c} />
        <Row label="Future Draft Years" value={String(state.maxDraftYears)} c={c} />
        <Row label="Rookie Draft Rounds" value={String(state.rookieDraftRounds)} c={c} />
        <Row label="Rookie Draft Order" value={state.rookieDraftOrder} c={c} />
        {state.rookieDraftOrder === 'Lottery' && (
          <Row label="Lottery Picks" value={String(state.lotteryPicks)} c={c} />
        )}
      </View>

      {/* Trade */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Trade Settings</ThemedText>
        <Row label="Veto Type" value={state.tradeVetoType} c={c} />
        {state.tradeVetoType !== 'None' && (
          <Row label="Review Period" value={`${state.tradeReviewPeriodHours} hrs`} c={c} />
        )}
        {state.tradeVetoType === 'League Vote' && (
          <Row label="Votes to Veto" value={String(state.tradeVotesToVeto)} c={c} />
        )}
      </View>

      {/* Season */}
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Season</ThemedText>
        <Row label="NBA Season" value={state.season} c={c} />
        <Row label="Regular Season" value={`${state.regularSeasonWeeks} weeks`} c={c} />
        <Row label="Playoffs" value={`${state.playoffWeeks} weeks`} c={c} />
      </View>

      <TouchableOpacity
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
