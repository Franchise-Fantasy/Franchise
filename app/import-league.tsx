import { capture } from '@/lib/posthog';
import { PlayerMatchList } from '@/components/import/PlayerMatchList';
import { ScreenshotImport } from '@/components/import/ScreenshotImport';
import { SleeperPreview } from '@/components/import/SleeperPreview';
import { StepDraft } from '@/components/create-league/StepDraft';
import { StepSeason, computeMaxWeeks } from '@/components/create-league/StepSeason';
import { StepTrade } from '@/components/create-league/StepTrade';
import { StepWaivers } from '@/components/create-league/StepWaivers';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { Colors } from '@/constants/Colors';
import {
  CURRENT_NBA_SEASON,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  type LeagueWizardState,
  SEEDING_TO_DB,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  useSleeperImport,
  useSleeperPreview,
  type SleeperPlayerMatch,
  type SleeperPreviewResult,
  type SleeperUnmatched,
} from '@/hooks/useImportSleeper';
import { mapSleeperPositions, mapSleeperScoring, computeRosterSize } from '@/utils/sleeperMapping';
import { ms, s } from '@/utils/scale';
import { useToast } from '@/context/ToastProvider';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type ImportSource = 'sleeper' | 'csv' | 'screenshots' | null;

// --- Wizard state ---

const STEP_LABELS = ['Fetch', 'Players', 'Settings', 'Review'];

interface ImportState {
  sleeperLeagueId: string;
  previewData: SleeperPreviewResult | null;
  resolvedMappings: Map<string, { player_id: string; name: string; position: string }>;
  skippedPlayers: Set<string>;
  wizardState: LeagueWizardState;
}

type Action =
  | { type: 'SET_SLEEPER_ID'; value: string }
  | { type: 'SET_PREVIEW'; data: SleeperPreviewResult }
  | { type: 'RESOLVE_PLAYER'; sleeperId: string; playerId: string; name: string; position: string }
  | { type: 'SKIP_PLAYER'; sleeperId: string }
  | { type: 'SET_WIZARD_FIELD'; field: keyof LeagueWizardState; value: any }
  | { type: 'SET_SCORING'; index: number; value: number }
  | { type: 'SET_ROSTER_SLOT'; index: number; count: number };

const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);

function buildWizardState(data: SleeperPreviewResult): LeagueWizardState {
  const rosterSlots = mapSleeperPositions(data.league.roster_positions);
  const scoring = mapSleeperScoring(data.league.scoring_settings);

  return {
    leagueType: 'Dynasty',
    keeperCount: 5,
    name: data.league.name,
    teams: data.teams.length,
    isPrivate: true,
    rosterSlots,
    scoringType: 'Points',
    scoring,
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    draftType: 'Snake',
    timePerPick: 90,
    maxDraftYears: 3,
    tradeVetoType: 'Commissioner',
    tradeReviewPeriodHours: 24,
    tradeVotesToVeto: 4,
    rookieDraftRounds: 2,
    rookieDraftOrder: 'Reverse Record',
    lotteryDraws: 4,
    lotteryOdds: null,
    waiverType: 'Standard',
    waiverPeriodDays: 2,
    faabBudget: 100,
    waiverDayOfWeek: 3,
    season: data.league.season ?? CURRENT_NBA_SEASON,
    regularSeasonWeeks: Math.max(1, maxWeeks - 3),
    playoffWeeks: 3,
    playoffTeams: Math.min(data.teams.length, 6),
    playoffSeedingFormat: 'Standard',
    reseedEachRound: false,
    pickConditionsEnabled: false,
    draftPickTradingEnabled: true,
    tradeDeadlineWeek: 0,
    buyIn: 0,
    taxiMaxExperience: null,
  };
}

const initialState: ImportState = {
  sleeperLeagueId: '',
  previewData: null,
  resolvedMappings: new Map(),
  skippedPlayers: new Set(),
  wizardState: {
    leagueType: 'Dynasty',
    keeperCount: 5,
    name: '',
    teams: 10,
    isPrivate: true,
    rosterSlots: DEFAULT_ROSTER_SLOTS.map(s => ({ ...s })),
    scoringType: 'Points',
    scoring: DEFAULT_SCORING.map(s => ({ ...s })),
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    draftType: 'Snake',
    timePerPick: 90,
    maxDraftYears: 3,
    tradeVetoType: 'Commissioner',
    tradeReviewPeriodHours: 24,
    tradeVotesToVeto: 4,
    rookieDraftRounds: 2,
    rookieDraftOrder: 'Reverse Record',
    lotteryDraws: 4,
    lotteryOdds: null,
    waiverType: 'Standard',
    waiverPeriodDays: 2,
    faabBudget: 100,
    waiverDayOfWeek: 3,
    season: CURRENT_NBA_SEASON,
    regularSeasonWeeks: maxWeeks - 3,
    playoffWeeks: 3,
    playoffTeams: 6,
    playoffSeedingFormat: 'Standard',
    reseedEachRound: false,
    pickConditionsEnabled: false,
    draftPickTradingEnabled: false,
    tradeDeadlineWeek: 0,
    buyIn: 0,
    taxiMaxExperience: null,
  },
};

function reducer(state: ImportState, action: Action): ImportState {
  switch (action.type) {
    case 'SET_SLEEPER_ID':
      return { ...state, sleeperLeagueId: action.value };
    case 'SET_PREVIEW':
      return {
        ...state,
        previewData: action.data,
        wizardState: buildWizardState(action.data),
        resolvedMappings: new Map(),
        skippedPlayers: new Set(),
      };
    case 'RESOLVE_PLAYER': {
      const newMap = new Map(state.resolvedMappings);
      newMap.set(action.sleeperId, { player_id: action.playerId, name: action.name, position: action.position });
      return { ...state, resolvedMappings: newMap };
    }
    case 'SKIP_PLAYER': {
      const newSet = new Set(state.skippedPlayers);
      newSet.add(action.sleeperId);
      return { ...state, skippedPlayers: newSet };
    }
    case 'SET_WIZARD_FIELD':
      return { ...state, wizardState: { ...state.wizardState, [action.field]: action.value } };
    case 'SET_SCORING': {
      const scoring = [...state.wizardState.scoring];
      scoring[action.index] = { ...scoring[action.index], point_value: action.value };
      return { ...state, wizardState: { ...state.wizardState, scoring } };
    }
    case 'SET_ROSTER_SLOT': {
      const slots = [...state.wizardState.rosterSlots];
      slots[action.index] = { ...slots[action.index], count: action.count };
      return { ...state, wizardState: { ...state.wizardState, rosterSlots: slots } };
    }
    default:
      return state;
  }
}

// --- Component ---

export default function ImportLeague() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();

  const [source, setSource] = useState<ImportSource>(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const previewMutation = useSleeperPreview();
  const importMutation = useSleeperImport();

  const handleFetch = useCallback(async () => {
    if (!state.sleeperLeagueId.trim()) {
      Alert.alert('Enter a Sleeper league ID');
      return;
    }
    try {
      const data = await previewMutation.mutateAsync(state.sleeperLeagueId.trim());
      dispatch({ type: 'SET_PREVIEW', data });
      setStep(1);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    } catch (err: any) {
      Alert.alert('Failed to fetch league', err.message ?? 'Unknown error');
    }
  }, [state.sleeperLeagueId, previewMutation]);

  const handleWizardChange = useCallback((field: keyof LeagueWizardState, value: any) => {
    dispatch({ type: 'SET_WIZARD_FIELD', field, value });
  }, []);

  const handleResolve = useCallback(
    (sleeperId: string, playerId: string, name: string, position: string) => {
      dispatch({ type: 'RESOLVE_PLAYER', sleeperId, playerId, name, position });
    },
    []
  );

  const handleSkip = useCallback((sleeperId: string) => {
    dispatch({ type: 'SKIP_PLAYER', sleeperId });
  }, []);

  const handleImport = useCallback(async () => {
    if (!state.previewData) return;

    const ws = state.wizardState;

    // Build player_mappings from matched + resolved
    const playerMappings: Array<{ sleeper_id: string; player_id: string; position: string }> = [];

    for (const m of state.previewData.player_matches) {
      if (m.matched_player_id) {
        playerMappings.push({
          sleeper_id: m.sleeper_id,
          player_id: m.matched_player_id,
          position: m.sleeper_team ?? '', // We'll get the real position from the edge function
        });
      }
    }

    // Add manually resolved players
    for (const [sleeperId, resolved] of state.resolvedMappings) {
      playerMappings.push({
        sleeper_id: sleeperId,
        player_id: resolved.player_id,
        position: resolved.position,
      });
    }

    const rosterSlots = ws.rosterSlots
      .filter(s => s.count > 0)
      .map(s => ({ position: s.position, count: s.count }));

    const scoring = ws.scoring.map(s => ({
      stat_name: s.stat_name,
      point_value: s.point_value,
    }));

    const payload = {
      sleeper_league_id: state.sleeperLeagueId,
      league_name: ws.name,
      player_mappings: playerMappings,
      roster_slots: rosterSlots,
      scoring,
      teams: state.previewData.teams.map(t => ({
        roster_id: t.roster_id,
        team_name: t.team_name,
      })),
      traded_picks: state.previewData.traded_picks,
      historical_seasons: state.previewData.historical_seasons,
      roster_positions: state.previewData.league.roster_positions,
      settings: {
        season: ws.season,
        regular_season_weeks: ws.regularSeasonWeeks,
        playoff_weeks: ws.playoffWeeks,
        playoff_teams: ws.playoffTeams,
        max_future_seasons: ws.maxDraftYears,
        rookie_draft_rounds: ws.rookieDraftRounds,
        rookie_draft_order: ws.rookieDraftOrder === 'Reverse Record' ? 'reverse_record' : 'lottery',
        lottery_draws: ws.lotteryDraws,
        lottery_odds: ws.lotteryOdds,
        trade_veto_type: ws.tradeVetoType === 'Commissioner'
          ? 'commissioner'
          : ws.tradeVetoType === 'League Vote'
            ? 'league_vote'
            : 'none',
        trade_review_period_hours: ws.tradeVetoType === 'None' ? 0 : ws.tradeReviewPeriodHours,
        trade_votes_to_veto: ws.tradeVotesToVeto,
        draft_pick_trading_enabled: ws.draftPickTradingEnabled,
        pick_conditions_enabled: ws.pickConditionsEnabled,
        waiver_type: ws.waiverType === 'Standard'
          ? 'standard'
          : ws.waiverType === 'FAAB'
            ? 'faab'
            : 'none',
        waiver_period_days: ws.waiverType === 'None' ? 0 : ws.waiverPeriodDays,
        faab_budget: ws.faabBudget,
        waiver_day_of_week: ws.waiverDayOfWeek,
        playoff_seeding_format: SEEDING_TO_DB[ws.playoffSeedingFormat] ?? 'standard',
        reseed_each_round: ws.reseedEachRound,
        buy_in_amount: ws.buyIn || null,
        trade_deadline: null,
      },
    };

    try {
      const result = await importMutation.mutateAsync(payload);
      capture('import_completed', { source: 'sleeper' });
      showToast('success', result.message);
      router.replace({
        pathname: '/claim-team',
        params: { leagueId: result.league_id, isCommissioner: 'true' },
      });
    } catch (err: any) {
      Alert.alert('Import failed', err.message ?? 'Unknown error');
    }
  }, [state, importMutation, router, showToast]);

  // Check if all unmatched players are resolved or skipped
  const unresolvedCount = (state.previewData?.unmatched_players ?? []).filter(
    p => !state.resolvedMappings.has(p.sleeper_id) && !state.skippedPlayers.has(p.sleeper_id)
  ).length;

  const canAdvanceFromPlayers = unresolvedCount === 0;

  // Source selection screen
  if (!source) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
          Import League
        </ThemedText>
        <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
          Choose how you'd like to import your existing league.
        </ThemedText>

        <View style={styles.sourceList}>
          <TouchableOpacity
            style={[styles.sourceCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setSource('sleeper')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Import from Sleeper"
          >
            <View style={[styles.sourceIcon, { backgroundColor: c.accent + '18' }]}>
              <Ionicons name="cloud-download-outline" size={28} color={c.accent} accessible={false} />
            </View>
            <View style={styles.sourceInfo}>
              <ThemedText type="defaultSemiBold" style={styles.sourceTitle}>Sleeper</ThemedText>
              <ThemedText style={[styles.sourceDesc, { color: c.secondaryText }]}>
                Import directly using your Sleeper league ID. Rosters, settings, and history are pulled automatically.
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceCard, { backgroundColor: c.card, borderColor: c.border, opacity: 0.5 }]}
            disabled
            accessibilityRole="button"
            accessibilityLabel="Import from CSV, coming soon"
            accessibilityState={{ disabled: true }}
          >
            <View style={[styles.sourceIcon, { backgroundColor: c.accent + '18' }]}>
              <Ionicons name="document-text-outline" size={28} color={c.accent} accessible={false} />
            </View>
            <View style={styles.sourceInfo}>
              <ThemedText type="defaultSemiBold" style={styles.sourceTitle}>CSV File</ThemedText>
              <ThemedText style={[styles.sourceDesc, { color: c.secondaryText }]}>
                Upload a CSV export from ESPN, Yahoo, or other platforms.
              </ThemedText>
              <ThemedText style={[styles.comingSoon, { color: c.accent }]}>Coming Soon</ThemedText>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setSource('screenshots')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Import from screenshots"
          >
            <View style={[styles.sourceIcon, { backgroundColor: c.accent + '18' }]}>
              <Ionicons name="camera-outline" size={28} color={c.accent} accessible={false} />
            </View>
            <View style={styles.sourceInfo}>
              <ThemedText type="defaultSemiBold" style={styles.sourceTitle}>Screenshots</ThemedText>
              <ThemedText style={[styles.sourceDesc, { color: c.secondaryText }]}>
                Take screenshots of your league and we'll extract the data for you using AI.
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  // Screenshot import has its own full wizard
  if (source === 'screenshots') {
    return <ScreenshotImport />;
  }

  return (
    <ThemedView style={styles.container}>
      <StepIndicator currentStep={step} steps={STEP_LABELS} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.contentInner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Step 0: Enter Sleeper League ID */}
          {step === 0 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                Import from Sleeper
              </ThemedText>
              <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                Enter your Sleeper league ID. You can find it in your league URL on Sleeper.
              </ThemedText>

              <TextInput
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                placeholder="e.g. 784512345678901234"
                placeholderTextColor={c.secondaryText}
                value={state.sleeperLeagueId}
                onChangeText={(v) => dispatch({ type: 'SET_SLEEPER_ID', value: v })}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                accessibilityLabel="Sleeper league ID"
              />

              <TouchableOpacity
                onPress={handleFetch}
                disabled={previewMutation.isPending || !state.sleeperLeagueId.trim()}
                style={[
                  styles.fetchBtn,
                  {
                    backgroundColor: state.sleeperLeagueId.trim()
                      ? c.accent
                      : c.buttonDisabled,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Fetch league from Sleeper"
                accessibilityState={{ disabled: previewMutation.isPending || !state.sleeperLeagueId.trim() }}
              >
                {previewMutation.isPending ? (
                  <ActivityIndicator color={c.accentText} />
                ) : (
                  <Text style={[styles.fetchBtnText, { color: c.accentText }]}>
                    Fetch League
                  </Text>
                )}
              </TouchableOpacity>

              {previewMutation.isError && (
                <ThemedText style={[styles.errorText, { color: c.danger }]}>
                  {previewMutation.error?.message}
                </ThemedText>
              )}
            </View>
          )}

          {/* Step 1: Preview + Player Matching */}
          {step === 1 && state.previewData && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                Review Import
              </ThemedText>

              <SleeperPreview data={state.previewData} />

              <View style={[styles.divider, { backgroundColor: c.cardAlt }]} />

              <PlayerMatchList
                matched={state.previewData.player_matches}
                unmatched={state.previewData.unmatched_players.filter(
                  p => !state.resolvedMappings.has(p.sleeper_id) && !state.skippedPlayers.has(p.sleeper_id)
                )}
                onResolve={handleResolve}
                onSkip={handleSkip}
              />
            </View>
          )}

          {/* Step 2: Settings Adjustment */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                League Settings
              </ThemedText>
              <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                Roster and scoring were imported from Sleeper. Adjust these settings for your league.
              </ThemedText>

              <View style={styles.settingsSection}>
                <ThemedText type="defaultSemiBold" style={styles.sectionLabel} accessibilityRole="header">
                  League Name
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                  value={state.wizardState.name}
                  onChangeText={(v) => handleWizardChange('name', v)}
                  placeholder="League name"
                  placeholderTextColor={c.secondaryText}
                  accessibilityLabel="League name"
                />
              </View>

              <StepTrade state={state.wizardState} onChange={handleWizardChange} />
              <StepWaivers state={state.wizardState} onChange={handleWizardChange} />
              <StepSeason state={state.wizardState} onChange={handleWizardChange} />
              <StepDraft state={state.wizardState} onChange={handleWizardChange} />
            </View>
          )}

          {/* Step 3: Review & Execute */}
          {step === 3 && state.previewData && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                Confirm Import
              </ThemedText>

              <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <SummaryRow label="League" value={state.wizardState.name} />
                <SummaryRow label="Teams" value={String(state.previewData.teams.length)} />
                <SummaryRow
                  label="Players"
                  value={`${state.previewData.player_matches.length + state.resolvedMappings.size} matched`}
                />
                <SummaryRow
                  label="Skipped"
                  value={`${state.skippedPlayers.size} players`}
                />
                <SummaryRow
                  label="History"
                  value={`${state.previewData.historical_seasons.length} seasons`}
                />
                <SummaryRow
                  label="Traded Picks"
                  value={String(state.previewData.traded_picks.length)}
                />
              </View>

              <ThemedText style={[styles.stepDesc, { color: c.secondaryText, marginTop: 12 }]}>
                After import, share the invite code with your league members. They'll join and you can assign each person to their team.
              </ThemedText>

              <TouchableOpacity
                onPress={handleImport}
                disabled={importMutation.isPending}
                style={[styles.importBtn, { backgroundColor: c.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Import league"
                accessibilityState={{ disabled: importMutation.isPending }}
              >
                {importMutation.isPending ? (
                  <ActivityIndicator color={c.accentText} />
                ) : (
                  <Text style={[styles.importBtnText, { color: c.accentText }]}>
                    Import League
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Navigation */}
      {step > 0 && step < STEP_LABELS.length - 1 && (
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={() => {
              setStep(s => s - 1);
              scrollRef.current?.scrollTo({ y: 0, animated: false });
            }}
            style={[styles.navBtn, { borderColor: c.border }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={[styles.navBtnText, { color: c.text }]}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setStep(s => s + 1);
              scrollRef.current?.scrollTo({ y: 0, animated: false });
            }}
            disabled={step === 1 && !canAdvanceFromPlayers}
            style={[
              styles.navBtn,
              {
                backgroundColor:
                  step === 1 && !canAdvanceFromPlayers ? c.buttonDisabled : c.accent,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Next, step ${step + 2} of ${STEP_LABELS.length}`}
            accessibilityState={{ disabled: step === 1 && !canAdvanceFromPlayers }}
          >
            <Text style={[styles.navBtnText, { color: c.accentText }]}>Next</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 3 && (
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={() => {
              setStep(s => s - 1);
              scrollRef.current?.scrollTo({ y: 0, animated: false });
            }}
            style={[styles.navBtn, { borderColor: c.border }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={[styles.navBtnText, { color: c.text }]}>Back</Text>
          </TouchableOpacity>
          <View />
        </View>
      )}
    </ThemedView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.summaryRow}>
      <ThemedText style={[styles.summaryLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <ThemedText style={styles.summaryValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: s(60),
    paddingHorizontal: s(20),
  },
  flex: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: s(24),
  },
  stepContent: {
    gap: s(12),
  },
  stepTitle: {
    fontSize: ms(22),
    marginBottom: s(4),
  },
  stepDesc: {
    fontSize: ms(14),
    lineHeight: ms(20),
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    fontSize: ms(16),
  },
  fetchBtn: {
    paddingVertical: s(14),
    borderRadius: 10,
    alignItems: 'center',
    marginTop: s(8),
  },
  fetchBtnText: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  errorText: {
    fontSize: ms(14),
    marginTop: s(8),
  },
  divider: {
    height: 1,
    marginVertical: s(16),
    opacity: 0.2,
  },
  settingsSection: {
    marginBottom: s(16),
  },
  sectionLabel: {
    fontSize: ms(15),
    marginBottom: s(8),
  },
  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(16),
    gap: s(4),
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: s(4),
  },
  summaryLabel: {
    fontSize: ms(14),
  },
  summaryValue: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  importBtn: {
    paddingVertical: s(16),
    borderRadius: 10,
    alignItems: 'center',
    marginTop: s(16),
  },
  importBtnText: {
    fontSize: ms(17),
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: s(16),
    paddingBottom: s(32),
  },
  navBtn: {
    paddingVertical: s(12),
    paddingHorizontal: s(28),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navBtnText: {
    fontSize: ms(16),
    fontWeight: '600',
  },
  sourceList: {
    gap: s(12),
    marginTop: s(20),
  },
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: s(16),
    gap: s(14),
  },
  sourceIcon: {
    width: s(52),
    height: s(52),
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceInfo: {
    flex: 1,
    gap: s(2),
  },
  sourceTitle: {
    fontSize: ms(16),
  },
  sourceDesc: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  comingSoon: {
    fontSize: ms(12),
    fontWeight: '700',
    marginTop: s(4),
  },
});

export const options = {
  headerShown: false,
};
