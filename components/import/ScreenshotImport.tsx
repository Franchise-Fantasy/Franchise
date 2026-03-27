import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { ScreenshotSettingsReview } from '@/components/import/ScreenshotSettingsReview';
import { TeamRosterReview } from '@/components/import/TeamRosterReview';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { StepDraft } from '@/components/create-league/StepDraft';
import { StepRoster } from '@/components/create-league/StepRoster';
import { StepScoring } from '@/components/create-league/StepScoring';
import { StepSeason, computeMaxWeeks } from '@/components/create-league/StepSeason';
import { StepTrade } from '@/components/create-league/StepTrade';
import { StepWaivers } from '@/components/create-league/StepWaivers';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { Colors } from '@/constants/Colors';
import {
  CURRENT_NBA_SEASON,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  LEAGUE_TYPE_OPTIONS,
  LEAGUE_TYPE_TO_DB,
  SEEDING_TO_DB,
  type CategoryConfig,
  type LeagueTypeOption,
  type LeagueWizardState,
  type ScoringTypeOption,
} from '@/constants/LeagueDefaults';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  useExtractHistory,
  useExtractRoster,
  useExtractSettings,
  useScreenshotImport,
  type HistoryExtractionResult,
  type ImageData,
  type ScreenshotPlayerMatch,
  type ScreenshotUnmatched,
  type SettingsExtractionResult,
} from '@/hooks/useImportScreenshot';
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

// --- Constants ---

const STEP_LABELS = ['Basics', 'Settings', 'Rosters', 'History', 'Config', 'Review'];
const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);

// --- State ---

interface TeamRosterData {
  team_name: string;
  images: ImageData[];
  matched: ScreenshotPlayerMatch[];
  unmatched: ScreenshotUnmatched[];
  resolvedMappings: Map<number, { player_id: string; name: string; position: string }>;
  skippedPlayers: Set<number>;
  extracted: boolean;
}

interface HistorySeasonData {
  images: ImageData[];
  extracted: HistoryExtractionResult | null;
}

interface ScreenshotImportState {
  wizardState: LeagueWizardState;
  teams: TeamRosterData[];
  currentTeamIndex: number;
  settingsImages: ImageData[];
  settingsExtracted: SettingsExtractionResult | null;
  settingsMode: 'choose' | 'screenshot' | 'manual';
  historySeasons: HistorySeasonData[];
  currentHistoryIndex: number;
}

type Action =
  | { type: 'SET_WIZARD_FIELD'; field: keyof LeagueWizardState; value: any }
  | { type: 'SET_SCORING'; index: number; value: number }
  | { type: 'SET_ROSTER_SLOT'; index: number; count: number }
  | { type: 'SET_TEAM_COUNT'; count: number }
  | { type: 'SET_TEAM_NAME'; teamIndex: number; name: string }
  | { type: 'SET_TEAM_IMAGES'; teamIndex: number; images: ImageData[] }
  | { type: 'SET_TEAM_EXTRACTION'; teamIndex: number; matched: ScreenshotPlayerMatch[]; unmatched: ScreenshotUnmatched[] }
  | { type: 'RESOLVE_PLAYER'; teamIndex: number; playerIndex: number; playerId: string; name: string; position: string }
  | { type: 'SKIP_PLAYER'; teamIndex: number; playerIndex: number }
  | { type: 'SET_CURRENT_TEAM'; index: number }
  | { type: 'SET_SETTINGS_IMAGES'; images: ImageData[] }
  | { type: 'SET_SETTINGS_EXTRACTED'; data: SettingsExtractionResult }
  | { type: 'SET_SETTINGS_MODE'; mode: 'choose' | 'screenshot' | 'manual' }
  | { type: 'APPLY_EXTRACTED_SCORING'; scoring: Record<string, number> }
  | { type: 'APPLY_EXTRACTED_ROSTER_POSITIONS'; positions: Array<{ position: string; count: number }> }
  | { type: 'SET_HISTORY_SEASON_COUNT'; count: number }
  | { type: 'SET_HISTORY_IMAGES'; seasonIndex: number; images: ImageData[] }
  | { type: 'SET_HISTORY_EXTRACTED'; seasonIndex: number; data: HistoryExtractionResult }
  | { type: 'SET_CURRENT_HISTORY'; index: number }
  | { type: 'RESET_SCORING' }
  | { type: 'RESET_ROSTER' }
  | { type: 'RESET_CATEGORIES' };

function createInitialTeams(count: number): TeamRosterData[] {
  return Array.from({ length: count }, (_, i) => ({
    team_name: `Team ${i + 1}`,
    images: [],
    matched: [],
    unmatched: [],
    resolvedMappings: new Map(),
    skippedPlayers: new Set(),
    extracted: false,
  }));
}

const initialWizard: LeagueWizardState = {
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
  regularSeasonWeeks: Math.max(1, maxWeeks - 3),
  playoffWeeks: 3,
  playoffTeams: 6,
  playoffSeedingFormat: 'Standard',
  reseedEachRound: false,
  pickConditionsEnabled: false,
  draftPickTradingEnabled: true,
  tradeDeadlineWeek: 0,
  buyIn: 0,
  taxiMaxExperience: null,
};

const initialState: ScreenshotImportState = {
  wizardState: initialWizard,
  teams: createInitialTeams(10),
  currentTeamIndex: 0,
  settingsImages: [],
  settingsExtracted: null,
  settingsMode: 'choose',
  historySeasons: [],
  currentHistoryIndex: 0,
};

function reducer(state: ScreenshotImportState, action: Action): ScreenshotImportState {
  switch (action.type) {
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

    case 'SET_TEAM_COUNT': {
      const count = Math.max(2, Math.min(16, action.count));
      const teams = createInitialTeams(count);
      // Preserve any existing team data
      for (let i = 0; i < Math.min(state.teams.length, count); i++) {
        teams[i] = state.teams[i];
      }
      return {
        ...state,
        wizardState: { ...state.wizardState, teams: count },
        teams,
        currentTeamIndex: Math.min(state.currentTeamIndex, count - 1),
      };
    }

    case 'SET_TEAM_NAME': {
      const teams = [...state.teams];
      teams[action.teamIndex] = { ...teams[action.teamIndex], team_name: action.name };
      return { ...state, teams };
    }

    case 'SET_TEAM_IMAGES': {
      const teams = [...state.teams];
      teams[action.teamIndex] = { ...teams[action.teamIndex], images: action.images, extracted: false };
      return { ...state, teams };
    }

    case 'SET_TEAM_EXTRACTION': {
      const teams = [...state.teams];
      teams[action.teamIndex] = {
        ...teams[action.teamIndex],
        matched: action.matched,
        unmatched: action.unmatched,
        extracted: true,
        resolvedMappings: new Map(),
        skippedPlayers: new Set(),
      };
      return { ...state, teams };
    }

    case 'RESOLVE_PLAYER': {
      const teams = [...state.teams];
      const team = { ...teams[action.teamIndex] };
      const newMap = new Map(team.resolvedMappings);
      newMap.set(action.playerIndex, { player_id: action.playerId, name: action.name, position: action.position });
      team.resolvedMappings = newMap;
      teams[action.teamIndex] = team;
      return { ...state, teams };
    }

    case 'SKIP_PLAYER': {
      const teams = [...state.teams];
      const team = { ...teams[action.teamIndex] };
      const newSet = new Set(team.skippedPlayers);
      newSet.add(action.playerIndex);
      team.skippedPlayers = newSet;
      teams[action.teamIndex] = team;
      return { ...state, teams };
    }

    case 'SET_CURRENT_TEAM':
      return { ...state, currentTeamIndex: action.index };

    case 'SET_SETTINGS_IMAGES':
      return { ...state, settingsImages: action.images };

    case 'SET_SETTINGS_EXTRACTED':
      return { ...state, settingsExtracted: action.data };

    case 'SET_SETTINGS_MODE':
      return { ...state, settingsMode: action.mode };

    case 'APPLY_EXTRACTED_SCORING': {
      const scoring = state.wizardState.scoring.map(s => {
        const val = action.scoring[s.stat_name];
        return val !== undefined ? { ...s, point_value: val } : s;
      });
      return { ...state, wizardState: { ...state.wizardState, scoring } };
    }

    case 'APPLY_EXTRACTED_ROSTER_POSITIONS': {
      const rosterSlots = state.wizardState.rosterSlots.map(s => {
        const match = action.positions.find(p => p.position.toUpperCase() === s.position);
        return match ? { ...s, count: match.count } : s;
      });
      return { ...state, wizardState: { ...state.wizardState, rosterSlots } };
    }

    case 'SET_HISTORY_SEASON_COUNT': {
      const count = Math.max(0, Math.min(10, action.count));
      const seasons: HistorySeasonData[] = Array.from({ length: count }, (_, i) =>
        state.historySeasons[i] ?? { images: [], extracted: null },
      );
      return {
        ...state,
        historySeasons: seasons,
        currentHistoryIndex: Math.min(state.currentHistoryIndex, Math.max(0, count - 1)),
      };
    }

    case 'SET_HISTORY_IMAGES': {
      const seasons = [...state.historySeasons];
      seasons[action.seasonIndex] = { ...seasons[action.seasonIndex], images: action.images };
      return { ...state, historySeasons: seasons };
    }

    case 'SET_HISTORY_EXTRACTED': {
      const seasons = [...state.historySeasons];
      seasons[action.seasonIndex] = { ...seasons[action.seasonIndex], extracted: action.data };
      return { ...state, historySeasons: seasons };
    }

    case 'SET_CURRENT_HISTORY':
      return { ...state, currentHistoryIndex: action.index };

    case 'RESET_SCORING':
      return { ...state, wizardState: { ...state.wizardState, scoring: DEFAULT_SCORING.map(s => ({ ...s })) } };

    case 'RESET_ROSTER':
      return { ...state, wizardState: { ...state.wizardState, rosterSlots: DEFAULT_ROSTER_SLOTS.map(s => ({ ...s })) } };

    case 'RESET_CATEGORIES':
      return { ...state, wizardState: { ...state.wizardState, categories: DEFAULT_CATEGORIES.map(c => ({ ...c })) } };

    default:
      return state;
  }
}

// --- Component ---

export function ScreenshotImport() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const extractRosterMutation = useExtractRoster();
  const extractSettingsMutation = useExtractSettings();
  const extractHistoryMutation = useExtractHistory();
  const importMutation = useScreenshotImport();

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const handleWizardChange = useCallback((field: keyof LeagueWizardState, value: any) => {
    dispatch({ type: 'SET_WIZARD_FIELD', field, value });
  }, []);

  // --- Roster extraction ---

  const handleExtractRoster = useCallback(async () => {
    const team = state.teams[state.currentTeamIndex];
    if (!team.images.length) {
      Alert.alert('Add a screenshot', 'Take or select a screenshot of this team\'s roster.');
      return;
    }

    try {
      const result = await extractRosterMutation.mutateAsync({
        images: team.images,
        team_name: team.team_name,
      });
      dispatch({
        type: 'SET_TEAM_EXTRACTION',
        teamIndex: state.currentTeamIndex,
        matched: result.matched,
        unmatched: result.unmatched,
      });
    } catch (err: any) {
      Alert.alert('Extraction failed', err.message ?? 'Could not extract roster from screenshot.');
    }
  }, [state.teams, state.currentTeamIndex, extractRosterMutation]);

  const handleResolvePlayer = useCallback((index: number, playerId: string, name: string, position: string) => {
    dispatch({ type: 'RESOLVE_PLAYER', teamIndex: state.currentTeamIndex, playerIndex: index, playerId, name, position });
  }, [state.currentTeamIndex]);

  const handleSkipPlayer = useCallback((index: number) => {
    dispatch({ type: 'SKIP_PLAYER', teamIndex: state.currentTeamIndex, playerIndex: index });
  }, [state.currentTeamIndex]);

  // --- Settings extraction ---

  const handleExtractSettings = useCallback(async () => {
    if (!state.settingsImages.length) {
      Alert.alert('Add a screenshot', 'Take or select a screenshot of your league settings.');
      return;
    }

    try {
      const result = await extractSettingsMutation.mutateAsync({ images: state.settingsImages });
      dispatch({ type: 'SET_SETTINGS_EXTRACTED', data: result });
    } catch (err: any) {
      Alert.alert('Extraction failed', err.message ?? 'Could not extract settings from screenshot.');
    }
  }, [state.settingsImages, extractSettingsMutation]);

  // --- History extraction ---

  const handleExtractHistory = useCallback(async (seasonIndex: number) => {
    const season = state.historySeasons[seasonIndex];
    if (!season?.images.length) {
      Alert.alert('Add a screenshot', 'Take or select a screenshot of your league standings.');
      return;
    }

    try {
      const result = await extractHistoryMutation.mutateAsync({ images: season.images });
      dispatch({ type: 'SET_HISTORY_EXTRACTED', seasonIndex, data: result });
    } catch (err: any) {
      Alert.alert('Extraction failed', err.message ?? 'Could not extract history from screenshot.');
    }
  }, [state.historySeasons, extractHistoryMutation]);

  // --- Import execution ---

  const handleImport = useCallback(async () => {
    const ws = state.wizardState;

    // Build teams payload — skip teams with no roster data
    const teamsPayload = state.teams
      .filter(team => team.extracted && (team.matched.length + team.resolvedMappings.size > 0))
      .map(team => {
        const players: Array<{ player_id: string; position: string; roster_slot: string | null }> = [];

        for (const m of team.matched) {
          players.push({
            player_id: m.matched_player_id,
            position: m.matched_position,
            roster_slot: m.roster_slot,
          });
        }

        for (const [index, resolved] of team.resolvedMappings) {
          const original = team.unmatched.find(u => u.index === index);
          players.push({
            player_id: resolved.player_id,
            position: resolved.position,
            roster_slot: original?.roster_slot ?? null,
          });
        }

        return { team_name: team.team_name, players };
      });

    if (teamsPayload.length === 0) {
      Alert.alert('No teams', 'At least one team must have an extracted roster to import.');
      return;
    }

    const rosterSlots = ws.rosterSlots
      .filter(s => s.count > 0)
      .map(s => ({ position: s.position, count: s.count }));

    const scoring = ws.scoring.map(s => ({
      stat_name: s.stat_name,
      point_value: s.point_value,
    }));

    const categories = ws.scoringType === 'H2H Categories'
      ? ws.categories.map(c => ({
        stat_name: c.stat_name,
        is_enabled: c.is_enabled,
        inverse: c.inverse,
      }))
      : undefined;

    // Build history payload from all extracted seasons
    let history: any[] | undefined;
    const extractedSeasons = state.historySeasons.filter(s => s.extracted?.teams?.length);
    if (extractedSeasons.length > 0) {
      history = extractedSeasons.map(s => ({
        season: s.extracted!.season ?? 'unknown',
        teams: s.extracted!.teams.map((t, i) => ({
          team_name: t.team_name,
          wins: t.wins ?? 0,
          losses: t.losses ?? 0,
          ties: t.ties ?? 0,
          points_for: t.points_for ?? 0,
          points_against: t.points_against ?? 0,
          standing: t.standing ?? i + 1,
        })),
      }));
    }

    const payload = {
      league_name: ws.name,
      league_type: LEAGUE_TYPE_TO_DB[ws.leagueType],
      keeper_count: ws.leagueType === 'Keeper' ? ws.keeperCount : null,
      teams: teamsPayload,
      roster_slots: rosterSlots,
      scoring_type: ws.scoringType === 'H2H Categories' ? 'categories' : 'points',
      scoring,
      categories,
      history,
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
      showToast('success', result.message);
      router.replace({
        pathname: '/claim-team',
        params: { leagueId: result.league_id, isCommissioner: 'true' },
      });
    } catch (err: any) {
      Alert.alert('Import failed', err.message ?? 'Unknown error');
    }
  }, [state, importMutation, router, showToast]);

  // --- Computed values ---

  const currentTeam = state.teams[state.currentTeamIndex];
  const unresolvedCount = currentTeam
    ? currentTeam.unmatched.filter(
      p => !currentTeam.resolvedMappings.has(p.index) && !currentTeam.skippedPlayers.has(p.index)
    ).length
    : 0;

  const allTeamsHaveRosters = state.teams.every(t => t.extracted && t.matched.length + t.resolvedMappings.size > 0);
  const totalPlayersImported = state.teams.reduce(
    (sum, t) => sum + t.matched.length + t.resolvedMappings.size, 0
  );

  return (
    <ThemedView style={styles.container}>
      <StepIndicator currentStep={step} steps={STEP_LABELS} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.contentInner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Step 0: League Basics */}
          {step === 0 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                League Basics
              </ThemedText>
              <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                Set up the basic info for your league. Rosters will be imported from screenshots.
              </ThemedText>

              <View style={styles.fieldGroup}>
                <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>League Name</ThemedText>
                <TextInput
                  style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                  value={state.wizardState.name}
                  onChangeText={(v) => handleWizardChange('name', v)}
                  placeholder="Enter league name"
                  placeholderTextColor={c.secondaryText}
                  accessibilityLabel="League name"
                />
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>Number of Teams</ThemedText>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, { borderColor: c.border }]}
                    onPress={() => dispatch({ type: 'SET_TEAM_COUNT', count: state.wizardState.teams - 1 })}
                    disabled={state.wizardState.teams <= 2}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease team count"
                  >
                    <Ionicons name="remove" size={20} color={c.text} accessible={false} />
                  </TouchableOpacity>
                  <ThemedText type="defaultSemiBold" style={styles.stepperValue}>
                    {state.wizardState.teams}
                  </ThemedText>
                  <TouchableOpacity
                    style={[styles.stepperBtn, { borderColor: c.border }]}
                    onPress={() => dispatch({ type: 'SET_TEAM_COUNT', count: state.wizardState.teams + 1 })}
                    disabled={state.wizardState.teams >= 16}
                    accessibilityRole="button"
                    accessibilityLabel="Increase team count"
                  >
                    <Ionicons name="add" size={20} color={c.text} accessible={false} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>League Type</ThemedText>
                <View style={styles.typeRow}>
                  {LEAGUE_TYPE_OPTIONS.map((lt) => (
                    <TouchableOpacity
                      key={lt}
                      style={[
                        styles.typeChip,
                        {
                          backgroundColor: state.wizardState.leagueType === lt ? c.accent : c.card,
                          borderColor: state.wizardState.leagueType === lt ? c.accent : c.border,
                        },
                      ]}
                      onPress={() => handleWizardChange('leagueType', lt)}
                      accessibilityRole="button"
                      accessibilityLabel={`League type: ${lt}`}
                      accessibilityState={{ selected: state.wizardState.leagueType === lt }}
                    >
                      <Text
                        style={[
                          styles.typeChipText,
                          { color: state.wizardState.leagueType === lt ? c.accentText : c.text },
                        ]}
                      >
                        {lt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {state.wizardState.leagueType === 'Keeper' && (
                <View style={styles.fieldGroup}>
                  <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>Keepers Per Team</ThemedText>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={[styles.stepperBtn, { borderColor: c.border }]}
                      onPress={() => handleWizardChange('keeperCount', Math.max(1, state.wizardState.keeperCount - 1))}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease keeper count"
                    >
                      <Ionicons name="remove" size={20} color={c.text} accessible={false} />
                    </TouchableOpacity>
                    <ThemedText type="defaultSemiBold" style={styles.stepperValue}>
                      {state.wizardState.keeperCount}
                    </ThemedText>
                    <TouchableOpacity
                      style={[styles.stepperBtn, { borderColor: c.border }]}
                      onPress={() => handleWizardChange('keeperCount', Math.min(15, state.wizardState.keeperCount + 1))}
                      accessibilityRole="button"
                      accessibilityLabel="Increase keeper count"
                    >
                      <Ionicons name="add" size={20} color={c.text} accessible={false} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Step 1: Settings (Screenshot or Manual) */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                League Settings
              </ThemedText>

              {state.settingsMode === 'choose' && (
                <>
                  <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                    How would you like to configure your league's roster and scoring settings?
                  </ThemedText>

                  <TouchableOpacity
                    style={[styles.modeCard, { backgroundColor: c.card, borderColor: c.border }]}
                    onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'screenshot' })}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Import settings from screenshot"
                  >
                    <View style={[styles.modeIcon, { backgroundColor: c.accent + '18' }]}>
                      <Ionicons name="camera-outline" size={24} color={c.accent} accessible={false} />
                    </View>
                    <View style={styles.modeInfo}>
                      <ThemedText type="defaultSemiBold">Screenshot Settings</ThemedText>
                      <ThemedText style={[styles.modeDesc, { color: c.secondaryText }]}>
                        Take a screenshot of your league's scoring or roster settings page. We'll extract what we can.
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={c.secondaryText} accessible={false} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modeCard, { backgroundColor: c.card, borderColor: c.border }]}
                    onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'manual' })}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Configure settings manually"
                  >
                    <View style={[styles.modeIcon, { backgroundColor: c.accent + '18' }]}>
                      <Ionicons name="settings-outline" size={24} color={c.accent} accessible={false} />
                    </View>
                    <View style={styles.modeInfo}>
                      <ThemedText type="defaultSemiBold">Configure Manually</ThemedText>
                      <ThemedText style={[styles.modeDesc, { color: c.secondaryText }]}>
                        Set up roster positions and scoring values yourself.
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={c.secondaryText} accessible={false} />
                  </TouchableOpacity>
                </>
              )}

              {state.settingsMode === 'screenshot' && (
                <>
                  <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                    Upload a screenshot of your league settings page (scoring, roster positions, etc.)
                  </ThemedText>

                  <ScreenshotCapture
                    images={state.settingsImages}
                    onImagesChange={(imgs) => dispatch({ type: 'SET_SETTINGS_IMAGES', images: imgs })}
                    maxImages={3}
                    label="Settings Screenshots"
                  />

                  {state.settingsImages.length > 0 && !state.settingsExtracted && (
                    <TouchableOpacity
                      onPress={handleExtractSettings}
                      disabled={extractSettingsMutation.isPending}
                      style={[styles.extractBtn, { backgroundColor: c.accent }]}
                      accessibilityRole="button"
                      accessibilityLabel="Extract settings from screenshots"
                    >
                      {extractSettingsMutation.isPending ? (
                        <ActivityIndicator color={c.accentText} />
                      ) : (
                        <Text style={[styles.extractBtnText, { color: c.accentText }]}>
                          Extract Settings
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}

                  {state.settingsExtracted && (
                    <ScreenshotSettingsReview
                      extracted={state.settingsExtracted}
                      onAcceptScoring={(scoring) => dispatch({ type: 'APPLY_EXTRACTED_SCORING', scoring })}
                      onAcceptRosterPositions={(positions) => dispatch({ type: 'APPLY_EXTRACTED_ROSTER_POSITIONS', positions })}
                      onAcceptLeagueName={(name) => handleWizardChange('name', name)}
                      onAcceptTeamCount={(count) => dispatch({ type: 'SET_TEAM_COUNT', count })}
                    />
                  )}

                  <TouchableOpacity
                    onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'manual' })}
                    style={styles.switchModeLink}
                    accessibilityRole="button"
                    accessibilityLabel="Switch to manual configuration"
                  >
                    <Text style={[styles.switchModeText, { color: c.accent }]}>
                      Edit manually instead
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {state.settingsMode === 'manual' && (
                <>
                  <StepRoster
                    state={state.wizardState}
                    onSlotChange={(i, count) => dispatch({ type: 'SET_ROSTER_SLOT', index: i, count })}
                    onChange={handleWizardChange}
                    onResetRoster={() => dispatch({ type: 'RESET_ROSTER' })}
                  />
                  <View style={[styles.divider, { backgroundColor: c.cardAlt }]} />
                  <StepScoring
                    state={state.wizardState}
                    onScoringChange={(i, val) => dispatch({ type: 'SET_SCORING', index: i, value: val })}
                    onResetScoring={() => dispatch({ type: 'RESET_SCORING' })}
                    onScoringTypeChange={(type) => handleWizardChange('scoringType', type)}
                    onCategoryToggle={(i, enabled) => {
                      const cats = [...state.wizardState.categories];
                      cats[i] = { ...cats[i], is_enabled: enabled };
                      handleWizardChange('categories', cats);
                    }}
                    onResetCategories={() => dispatch({ type: 'RESET_CATEGORIES' })}
                  />

                  {state.settingsExtracted && (
                    <TouchableOpacity
                      onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'screenshot' })}
                      style={styles.switchModeLink}
                      accessibilityRole="button"
                      accessibilityLabel="Switch to screenshot extraction"
                    >
                      <Text style={[styles.switchModeText, { color: c.accent }]}>
                        View extracted settings
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}

          {/* Step 2: Team Rosters */}
          {step === 2 && currentTeam && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                Team Rosters
              </ThemedText>

              {/* Team progress bar */}
              <View style={[styles.progressBar, { backgroundColor: c.card, borderColor: c.border }]}>
                {state.teams.map((t, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.progressDot,
                      {
                        backgroundColor: t.extracted
                          ? c.success
                          : i === state.currentTeamIndex
                            ? c.accent
                            : c.border,
                      },
                    ]}
                    onPress={() => dispatch({ type: 'SET_CURRENT_TEAM', index: i })}
                    accessibilityRole="button"
                    accessibilityLabel={`Team ${i + 1}${t.extracted ? ', completed' : ''}`}
                  />
                ))}
              </View>

              <ThemedText style={[styles.teamProgress, { color: c.secondaryText }]}>
                Team {state.currentTeamIndex + 1} of {state.teams.length}
              </ThemedText>

              {/* Team name */}
              <View style={styles.fieldGroup}>
                <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>Team Name</ThemedText>
                <TextInput
                  style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                  value={currentTeam.team_name}
                  onChangeText={(v) => dispatch({ type: 'SET_TEAM_NAME', teamIndex: state.currentTeamIndex, name: v })}
                  placeholder="Team name"
                  placeholderTextColor={c.secondaryText}
                  accessibilityLabel="Team name"
                />
              </View>

              {/* Screenshot capture */}
              <ScreenshotCapture
                images={currentTeam.images}
                onImagesChange={(imgs) => dispatch({ type: 'SET_TEAM_IMAGES', teamIndex: state.currentTeamIndex, images: imgs })}
                maxImages={5}
                label="Roster Screenshots"
              />

              {/* Extract button */}
              {currentTeam.images.length > 0 && !currentTeam.extracted && (
                <TouchableOpacity
                  onPress={handleExtractRoster}
                  disabled={extractRosterMutation.isPending}
                  style={[styles.extractBtn, { backgroundColor: c.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel="Extract roster from screenshots"
                >
                  {extractRosterMutation.isPending ? (
                    <ActivityIndicator color={c.accentText} />
                  ) : (
                    <Text style={[styles.extractBtnText, { color: c.accentText }]}>
                      Extract Roster
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              {/* Extraction results */}
              {currentTeam.extracted && (
                <TeamRosterReview
                  teamName={currentTeam.team_name}
                  matched={currentTeam.matched}
                  unmatched={currentTeam.unmatched.filter(
                    p => !currentTeam.resolvedMappings.has(p.index) && !currentTeam.skippedPlayers.has(p.index)
                  )}
                  resolvedCount={currentTeam.resolvedMappings.size}
                  skippedCount={currentTeam.skippedPlayers.size}
                  onResolve={handleResolvePlayer}
                  onSkip={handleSkipPlayer}
                />
              )}

              {/* Re-capture button */}
              {currentTeam.extracted && (
                <TouchableOpacity
                  onPress={() => dispatch({ type: 'SET_TEAM_IMAGES', teamIndex: state.currentTeamIndex, images: [] })}
                  style={styles.switchModeLink}
                  accessibilityRole="button"
                  accessibilityLabel="Re-capture this team's roster"
                >
                  <Text style={[styles.switchModeText, { color: c.accent }]}>
                    Re-capture screenshots
                  </Text>
                </TouchableOpacity>
              )}

              {/* Next/Previous team navigation */}
              <View style={styles.teamNavRow}>
                {state.currentTeamIndex > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      dispatch({ type: 'SET_CURRENT_TEAM', index: state.currentTeamIndex - 1 });
                      scrollToTop();
                    }}
                    style={[styles.teamNavBtn, { borderColor: c.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Previous team"
                  >
                    <Ionicons name="chevron-back" size={16} color={c.text} accessible={false} />
                    <Text style={[styles.teamNavText, { color: c.text }]}>Prev Team</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.flex} />
                {state.currentTeamIndex < state.teams.length - 1 && currentTeam.extracted && unresolvedCount === 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      dispatch({ type: 'SET_CURRENT_TEAM', index: state.currentTeamIndex + 1 });
                      scrollToTop();
                    }}
                    style={[styles.teamNavBtn, { backgroundColor: c.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel="Next team"
                  >
                    <Text style={[styles.teamNavText, { color: c.accentText }]}>Next Team</Text>
                    <Ionicons name="chevron-forward" size={16} color={c.accentText} accessible={false} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Step 3: History (Optional) */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                League History
              </ThemedText>
              <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                Optional: Import past season standings. Set the number of seasons below, or skip this step.
              </ThemedText>

              {/* Season count stepper */}
              <View style={styles.fieldGroup}>
                <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>
                  Seasons of History
                </ThemedText>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    onPress={() => dispatch({ type: 'SET_HISTORY_SEASON_COUNT', count: state.historySeasons.length - 1 })}
                    style={[styles.stepperBtn, { borderColor: c.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease season count"
                  >
                    <Ionicons name="remove" size={18} color={c.text} accessible={false} />
                  </TouchableOpacity>
                  <ThemedText style={styles.stepperValue}>{state.historySeasons.length}</ThemedText>
                  <TouchableOpacity
                    onPress={() => dispatch({ type: 'SET_HISTORY_SEASON_COUNT', count: state.historySeasons.length + 1 })}
                    style={[styles.stepperBtn, { borderColor: c.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Increase season count"
                  >
                    <Ionicons name="add" size={18} color={c.text} accessible={false} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Season tabs + capture */}
              {state.historySeasons.length > 0 && (
                <View style={{ gap: 12 }}>
                  {/* Season selector dots */}
                  {state.historySeasons.length > 1 && (
                    <View style={[styles.progressBar, { borderColor: c.border }]}>
                      {state.historySeasons.map((s, i) => (
                        <TouchableOpacity
                          key={i}
                          onPress={() => dispatch({ type: 'SET_CURRENT_HISTORY', index: i })}
                          style={[
                            styles.progressDot,
                            {
                              backgroundColor:
                                i === state.currentHistoryIndex
                                  ? c.accent
                                  : s.extracted
                                    ? c.success
                                    : c.border,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Season ${i + 1}${s.extracted ? ', extracted' : ''}`}
                        />
                      ))}
                      <Text style={[styles.teamProgress, { color: c.secondaryText }]}>
                        Season {state.currentHistoryIndex + 1} of {state.historySeasons.length}
                      </Text>
                    </View>
                  )}

                  {/* Current season capture */}
                  {state.historySeasons[state.currentHistoryIndex] && (
                    <View style={{ gap: 12 }}>
                      <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>
                        Season {state.currentHistoryIndex + 1} Standings
                      </ThemedText>

                      <ScreenshotCapture
                        images={state.historySeasons[state.currentHistoryIndex].images}
                        onImagesChange={(imgs) =>
                          dispatch({ type: 'SET_HISTORY_IMAGES', seasonIndex: state.currentHistoryIndex, images: imgs })
                        }
                        maxImages={3}
                        label="Standings Screenshots"
                      />

                      {state.historySeasons[state.currentHistoryIndex].images.length > 0 &&
                        !state.historySeasons[state.currentHistoryIndex].extracted && (
                          <TouchableOpacity
                            onPress={() => handleExtractHistory(state.currentHistoryIndex)}
                            disabled={extractHistoryMutation.isPending}
                            style={[styles.extractBtn, { backgroundColor: c.accent }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Extract history for season ${state.currentHistoryIndex + 1}`}
                          >
                            {extractHistoryMutation.isPending ? (
                              <ActivityIndicator color={c.accentText} />
                            ) : (
                              <Text style={[styles.extractBtnText, { color: c.accentText }]}>
                                Extract History
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}

                      {state.historySeasons[state.currentHistoryIndex].extracted &&
                        state.historySeasons[state.currentHistoryIndex].extracted!.teams.length > 0 && (
                          <View style={[styles.historyCard, { backgroundColor: c.card, borderColor: c.border }]}>
                            <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>
                              Extracted Standings{' '}
                              {state.historySeasons[state.currentHistoryIndex].extracted!.season
                                ? `(${state.historySeasons[state.currentHistoryIndex].extracted!.season})`
                                : ''}
                            </ThemedText>
                            {state.historySeasons[state.currentHistoryIndex].extracted!.teams.map((t, i, arr) => (
                              <View key={i} style={[styles.historyRow, { borderBottomColor: c.border }, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                                <ThemedText style={styles.historyRank}>
                                  {t.standing ?? i + 1}.
                                </ThemedText>
                                <ThemedText style={styles.historyTeam} numberOfLines={1}>
                                  {t.team_name}
                                </ThemedText>
                                <Text style={[styles.historyRecord, { color: c.secondaryText }]}>
                                  {t.wins ?? 0}-{t.losses ?? 0}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}

                      {/* Season navigation */}
                      {state.historySeasons.length > 1 && (
                        <View style={styles.teamNavRow}>
                          {state.currentHistoryIndex > 0 && (
                            <TouchableOpacity
                              onPress={() => {
                                dispatch({ type: 'SET_CURRENT_HISTORY', index: state.currentHistoryIndex - 1 });
                                scrollToTop();
                              }}
                              style={[styles.teamNavBtn, { borderColor: c.border }]}
                              accessibilityRole="button"
                              accessibilityLabel="Previous season"
                            >
                              <Ionicons name="chevron-back" size={16} color={c.text} accessible={false} />
                              <Text style={[styles.teamNavText, { color: c.text }]}>Prev Season</Text>
                            </TouchableOpacity>
                          )}
                          <View style={styles.flex} />
                          {state.currentHistoryIndex < state.historySeasons.length - 1 && (
                            <TouchableOpacity
                              onPress={() => {
                                dispatch({ type: 'SET_CURRENT_HISTORY', index: state.currentHistoryIndex + 1 });
                                scrollToTop();
                              }}
                              style={[styles.teamNavBtn, { backgroundColor: c.accent }]}
                              accessibilityRole="button"
                              accessibilityLabel="Next season"
                            >
                              <Text style={[styles.teamNavText, { color: c.accentText }]}>Next Season</Text>
                              <Ionicons name="chevron-forward" size={16} color={c.accentText} accessible={false} />
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Step 4: Remaining Settings */}
          {step === 4 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                League Configuration
              </ThemedText>
              <ThemedText style={[styles.stepDesc, { color: c.secondaryText }]}>
                Configure trade, waiver, season, and draft settings for your league.
              </ThemedText>

              <StepTrade state={state.wizardState} onChange={handleWizardChange} />
              <View style={[styles.divider, { backgroundColor: c.cardAlt }]} />
              <StepWaivers state={state.wizardState} onChange={handleWizardChange} />
              <View style={[styles.divider, { backgroundColor: c.cardAlt }]} />
              <StepSeason state={state.wizardState} onChange={handleWizardChange} />
              <View style={[styles.divider, { backgroundColor: c.cardAlt }]} />
              <StepDraft state={state.wizardState} onChange={handleWizardChange} />
            </View>
          )}

          {/* Step 5: Review & Execute */}
          {step === 5 && (
            <View style={styles.stepContent}>
              <ThemedText type="title" style={styles.stepTitle} accessibilityRole="header">
                Review Import
              </ThemedText>

              <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <SummaryRow label="League" value={state.wizardState.name || 'Unnamed'} />
                <SummaryRow label="Type" value={state.wizardState.leagueType} />
                <SummaryRow label="Teams" value={String(state.teams.length)} />
                <SummaryRow label="Total Players" value={String(totalPlayersImported)} />
                <SummaryRow
                  label="Scoring"
                  value={state.wizardState.scoringType}
                />
                {(() => {
                  const extracted = state.historySeasons.filter(s => s.extracted?.teams?.length);
                  return extracted.length > 0 ? (
                    <SummaryRow label="History" value={`${extracted.length} season${extracted.length > 1 ? 's' : ''}`} />
                  ) : (
                    <SummaryRow label="History" value="None" />
                  );
                })()}
              </View>

              {/* Teams with rosters summary */}
              <ThemedText type="defaultSemiBold" style={[styles.fieldLabel, { marginTop: 16 }]}>
                Teams & Rosters
              </ThemedText>
              {state.teams.map((team, i) => (
                <View
                  key={i}
                  style={[styles.teamSummaryRow, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <View style={styles.teamSummaryInfo}>
                    <ThemedText type="defaultSemiBold" style={styles.teamSummaryName}>
                      {team.team_name}
                    </ThemedText>
                    <Text style={[styles.teamSummaryCount, { color: c.secondaryText }]}>
                      {team.matched.length + team.resolvedMappings.size} players
                    </Text>
                  </View>
                  {team.extracted ? (
                    <Ionicons name="checkmark-circle" size={20} color={c.success} accessible={false} />
                  ) : (
                    <Ionicons name="alert-circle" size={20} color={c.warning} accessible={false} />
                  )}
                </View>
              ))}

              <ThemedText style={[styles.stepDesc, { color: c.secondaryText, marginTop: 12 }]}>
                After import, share the invite code with your league members. They'll join and you can assign each person to their team.
              </ThemedText>

              <TouchableOpacity
                onPress={handleImport}
                disabled={importMutation.isPending || !state.wizardState.name.trim()}
                style={[
                  styles.importBtn,
                  { backgroundColor: state.wizardState.name.trim() ? c.accent : c.buttonDisabled },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Import league"
                accessibilityState={{ disabled: importMutation.isPending || !state.wizardState.name.trim() }}
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
      <View style={styles.navRow}>
        {step > 0 && (
          <TouchableOpacity
            onPress={() => {
              setStep(s => s - 1);
              scrollToTop();
            }}
            style={[styles.navBtn, { borderColor: c.border, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={[styles.navBtnText, { color: c.text }]}>Back</Text>
          </TouchableOpacity>
        )}
        <View style={styles.flex} />
        {step < STEP_LABELS.length - 1 && (
          <TouchableOpacity
            onPress={() => {
              setStep(s => s + 1);
              scrollToTop();
            }}
            disabled={step === 0 && !state.wizardState.name.trim()}
            style={[
              styles.navBtn,
              {
                backgroundColor:
                  step === 0 && !state.wizardState.name.trim()
                    ? c.buttonDisabled
                    : c.accent,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Next, step ${step + 2} of ${STEP_LABELS.length}`}
          >
            {step === 3 ? (
              <Text style={[styles.navBtnText, { color: c.accentText }]}>
                {state.historySeasons.length > 0 ? 'Next' : 'Skip'}
              </Text>
            ) : (
              <Text style={[styles.navBtnText, { color: c.accentText }]}>Next</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
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
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  flex: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: 24,
  },
  stepContent: {
    gap: 12,
  },
  stepTitle: {
    fontSize: 22,
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 15,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontSize: 20,
    minWidth: 30,
    textAlign: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  modeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeInfo: {
    flex: 1,
    gap: 2,
  },
  modeDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  extractBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  extractBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  switchModeLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchModeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginVertical: 16,
    opacity: 0.2,
  },
  progressBar: {
    flexDirection: 'row',
    gap: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  teamProgress: {
    fontSize: 13,
    textAlign: 'center',
  },
  teamNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  teamNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  teamNavText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyRank: {
    fontSize: 14,
    fontWeight: '600',
    width: 24,
  },
  historyTeam: {
    fontSize: 14,
    flex: 1,
  },
  historyRecord: {
    fontSize: 13,
    fontWeight: '500',
  },
  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  teamSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: 6,
  },
  teamSummaryInfo: {
    flex: 1,
  },
  teamSummaryName: {
    fontSize: 14,
  },
  teamSummaryCount: {
    fontSize: 12,
    marginTop: 2,
  },
  importBtn: {
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  importBtnText: {
    fontSize: 17,
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    paddingVertical: 16,
    paddingBottom: 32,
  },
  navBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
