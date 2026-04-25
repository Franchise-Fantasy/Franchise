import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { StepBasics } from '@/components/create-league/StepBasics';
import { StepDraft } from '@/components/create-league/StepDraft';
import { StepReview } from '@/components/create-league/StepReview';
import { StepRoster } from '@/components/create-league/StepRoster';
import { StepScoring } from '@/components/create-league/StepScoring';
import {
  StepSeason,
  computeMaxWeeks,
  computeSeasonStart,
} from '@/components/create-league/StepSeason';
import { StepTrade } from '@/components/create-league/StepTrade';
import { StepWaivers } from '@/components/create-league/StepWaivers';
import { PlayerMatchList } from '@/components/import/PlayerMatchList';
import { ScreenshotImport } from '@/components/import/ScreenshotImport';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { FormSection } from '@/components/ui/FormSection';
import { ListRow } from '@/components/ui/ListRow';
import { Section } from '@/components/ui/Section';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import {
  CURRENT_NBA_SEASON,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  type LeagueWizardState,
  SEEDING_TO_DB,
  type ScoringTypeOption,
} from '@/constants/LeagueDefaults';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  useSleeperImport,
  useSleeperPreview,
  type SleeperPreviewResult,
} from '@/hooks/useImportSleeper';
import { capture } from '@/lib/posthog';
import { calcLotteryPoolSize, getPlayoffTeamOptions } from '@/utils/league/lottery';
import { ms, s } from '@/utils/scale';
import { mapSleeperPositions, mapSleeperScoring } from '@/utils/sleeperMapping';

type ImportSource = 'sleeper' | 'screenshots' | null;

// --- Wizard state ---

// Mirrors create-league's step sequence (Basics → Roster → Scoring →
// Waivers → Season → Trade → Draft → Review) with two import-only
// steps slotted in at the front (Fetch, Players). Users get the same
// screen-per-topic pacing as create-league — just pre-filled.
const STEP_LABELS = [
  'Fetch',
  'Players',
  'Basics',
  'Roster',
  'Scoring',
  'Waivers',
  'Season',
  'Trade',
  'Draft',
  'Review',
];

const STEP_FETCH = 0;
const STEP_PLAYERS = 1;
const STEP_BASICS = 2;
const STEP_ROSTER = 3;
const STEP_SCORING = 4;
const STEP_WAIVERS = 5;
const STEP_SEASON = 6;
const STEP_TRADE = 7;
const STEP_DRAFT = 8;
const STEP_REVIEW = 9;

interface ImportState {
  sleeperLeagueId: string;
  previewData: SleeperPreviewResult | null;
  resolvedMappings: Map<string, { player_id: string; name: string; position: string }>;
  skippedPlayers: Set<string>;
  wizardState: LeagueWizardState;
}

type Action =
  | { type: 'HYDRATE'; state: ImportState }
  | { type: 'SET_SLEEPER_ID'; value: string }
  | { type: 'SET_PREVIEW'; data: SleeperPreviewResult }
  | { type: 'RESOLVE_PLAYER'; sleeperId: string; playerId: string; name: string; position: string }
  | { type: 'SKIP_PLAYER'; sleeperId: string }
  | { type: 'SET_WIZARD_FIELD'; field: keyof LeagueWizardState; value: any }
  | { type: 'SET_SCORING'; index: number; value: number }
  | { type: 'SET_ROSTER_SLOT'; index: number; count: number }
  | { type: 'RESET_SCORING' }
  | { type: 'RESET_ROSTER' }
  | { type: 'SET_SCORING_TYPE'; value: ScoringTypeOption }
  | { type: 'SET_CATEGORY_ENABLED'; index: number; enabled: boolean }
  | { type: 'RESET_CATEGORIES' };

const SLEEPER_STORAGE_KEY = '@sleeper_import_wizard';

interface PersistedSleeperState {
  sleeperLeagueId: string;
  previewData: SleeperPreviewResult | null;
  resolvedMappings: [string, { player_id: string; name: string; position: string }][];
  skippedPlayers: string[];
  wizardState: LeagueWizardState;
  step: number;
  source: ImportSource;
}

function serializeSleeperState(s: ImportState, step: number, src: ImportSource): PersistedSleeperState {
  return {
    sleeperLeagueId: s.sleeperLeagueId,
    previewData: s.previewData,
    resolvedMappings: Array.from(s.resolvedMappings.entries()),
    skippedPlayers: Array.from(s.skippedPlayers),
    wizardState: s.wizardState,
    step,
    source: src,
  };
}

function deserializeSleeperState(p: PersistedSleeperState): ImportState {
  return {
    sleeperLeagueId: p.sleeperLeagueId ?? '',
    previewData: p.previewData ?? null,
    resolvedMappings: new Map(p.resolvedMappings ?? []),
    skippedPlayers: new Set(p.skippedPlayers ?? []),
    wizardState: p.wizardState,
  };
}

const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);

// TODO(shared-state): duplicated from app/create-league.tsx. Extract to
// utils/lottery.ts (or similar) once both flows settle.
function clampLotteryState(s: LeagueWizardState): LeagueWizardState {
  const options = getPlayoffTeamOptions(s.playoffWeeks, s.teams);
  let pt = s.playoffTeams;
  if (!options.includes(pt)) {
    pt =
      options.length > 0
        ? options.reduce((best, o) => (Math.abs(o - pt) < Math.abs(best - pt) ? o : best), options[0])
        : 0;
  }
  const pool = calcLotteryPoolSize(s.teams, pt);
  const draws = pool > 0 ? Math.min(s.lotteryDraws, pool) : 0;
  const odds = s.lotteryOdds && s.lotteryOdds.length !== pool ? null : s.lotteryOdds;
  return { ...s, playoffTeams: pt, lotteryDraws: draws, lotteryOdds: odds };
}

function buildWizardState(data: SleeperPreviewResult): LeagueWizardState {
  const rosterSlots = mapSleeperPositions(data.league.roster_positions);
  const scoring = mapSleeperScoring(data.league.scoring_settings);

  return {
    sport: 'nba',
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
    initialDraftOrder: 'Random',
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
    seasonStartDate: null,
    regularSeasonWeeks: Math.max(1, maxWeeks - 3),
    playoffWeeks: 3,
    playoffTeams: Math.min(data.teams.length, 6),
    playoffSeedingFormat: 'Standard',
    reseedEachRound: false,
    pickConditionsEnabled: false,
    draftPickTradingEnabled: true,
    tradeDeadlineWeek: 0,
    buyIn: 0,
    venmoUsername: '',
    cashappTag: '',
    paypalUsername: '',
    taxiMaxExperience: null,
    weeklyAcquisitionLimit: null,
    playerLockType: 'Daily',
    autoRumorsEnabled: false,
    tiebreakerPrimary: 'Head-to-Head',
    divisionCount: 1,
    division1Name: 'Division 1',
    division2Name: 'Division 2',
    positionLimits: {},
  };
}

const initialState: ImportState = {
  sleeperLeagueId: '',
  previewData: null,
  resolvedMappings: new Map(),
  skippedPlayers: new Set(),
  wizardState: {
    sport: 'nba',
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
    initialDraftOrder: 'Random',
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
    seasonStartDate: null,
    regularSeasonWeeks: maxWeeks - 3,
    playoffWeeks: 3,
    playoffTeams: 6,
    playoffSeedingFormat: 'Standard',
    reseedEachRound: false,
    pickConditionsEnabled: false,
    draftPickTradingEnabled: false,
    tradeDeadlineWeek: 0,
    buyIn: 0,
    venmoUsername: '',
    cashappTag: '',
    paypalUsername: '',
    taxiMaxExperience: null,
    weeklyAcquisitionLimit: null,
    playerLockType: 'Daily',
    autoRumorsEnabled: false,
    tiebreakerPrimary: 'Head-to-Head',
    divisionCount: 1,
    division1Name: 'Division 1',
    division2Name: 'Division 2',
    positionLimits: {},
  },
};

function reducer(state: ImportState, action: Action): ImportState {
  const updateWizard = (next: LeagueWizardState): ImportState => ({ ...state, wizardState: next });

  switch (action.type) {
    case 'HYDRATE':
      return action.state;
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
    case 'SET_WIZARD_FIELD': {
      const next: LeagueWizardState = { ...state.wizardState, [action.field]: action.value };
      // Re-clamp lottery settings when dependent fields change — mirrors
      // create-league's reducer so lottery-draws / odds stay valid.
      if (action.field === 'teams' || action.field === 'playoffWeeks' || action.field === 'playoffTeams') {
        return updateWizard(clampLotteryState(next));
      }
      if (action.field === 'seasonStartDate') {
        const start = action.value
          ? (() => {
              const [sy, sm, sd] = (action.value as string).split('-').map(Number);
              return new Date(sy, sm - 1, sd);
            })()
          : computeSeasonStart();
        const newMax = computeMaxWeeks(next.season, start);
        const playoffWeeks = Math.min(next.playoffWeeks, Math.max(1, newMax - 1));
        const regularSeasonWeeks = Math.min(next.regularSeasonWeeks, Math.max(1, newMax - playoffWeeks));
        return updateWizard(clampLotteryState({ ...next, regularSeasonWeeks, playoffWeeks }));
      }
      if (action.field === 'leagueType' && action.value !== 'Dynasty') {
        return updateWizard({
          ...next,
          draftPickTradingEnabled: false,
          pickConditionsEnabled: false,
          maxDraftYears: 0,
        });
      }
      if (action.field === 'leagueType' && action.value === 'Dynasty') {
        return updateWizard({ ...next, maxDraftYears: 3 });
      }
      return updateWizard(next);
    }
    case 'SET_SCORING': {
      const scoring = [...state.wizardState.scoring];
      scoring[action.index] = { ...scoring[action.index], point_value: action.value };
      return updateWizard({ ...state.wizardState, scoring });
    }
    case 'SET_ROSTER_SLOT': {
      const slots = [...state.wizardState.rosterSlots];
      slots[action.index] = { ...slots[action.index], count: action.count };
      return updateWizard({ ...state.wizardState, rosterSlots: slots });
    }
    case 'RESET_SCORING':
      return updateWizard({ ...state.wizardState, scoring: DEFAULT_SCORING.map(s => ({ ...s })) });
    case 'RESET_ROSTER':
      return updateWizard({
        ...state.wizardState,
        rosterSlots: DEFAULT_ROSTER_SLOTS.map(s => ({ ...s })),
        positionLimits: {},
      });
    case 'SET_SCORING_TYPE':
      return updateWizard({ ...state.wizardState, scoringType: action.value });
    case 'SET_CATEGORY_ENABLED': {
      const cats = [...state.wizardState.categories];
      cats[action.index] = { ...cats[action.index], is_enabled: action.enabled };
      return updateWizard({ ...state.wizardState, categories: cats });
    }
    case 'RESET_CATEGORIES':
      return updateWizard({ ...state.wizardState, categories: DEFAULT_CATEGORIES.map(c => ({ ...c })) });
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
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);
  // Gate the auto-save effect until the resume / start-over choice
  // has settled, so the saved state isn't overwritten with the
  // initialState mid-prompt.
  const hasRestoredRef = useRef(false);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setIsAtBottom(false);
  }, [step]);

  const recomputeHint = useCallback(() => {
    const v = viewportHeightRef.current;
    const ch = contentHeightRef.current;
    if (v > 0 && ch > 0) {
      setHasMoreContent(ch > v + 20);
    }
  }, []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
      setIsAtBottom(distanceFromBottom < 20);
      viewportHeightRef.current = layoutMeasurement.height;
      contentHeightRef.current = contentSize.height;
      recomputeHint();
    },
    [recomputeHint],
  );

  const handleLayout = useCallback(
    (e: NativeSyntheticEvent<{ layout: { height: number } }>) => {
      viewportHeightRef.current = e.nativeEvent.layout.height;
      recomputeHint();
    },
    [recomputeHint],
  );

  const handleContentSizeChange = useCallback(
    (_w: number, h: number) => {
      contentHeightRef.current = h;
      recomputeHint();
    },
    [recomputeHint],
  );

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
      setStep(STEP_PLAYERS);
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

    const playerMappings: { sleeper_id: string; player_id: string; position: string }[] = [];

    for (const m of state.previewData.player_matches) {
      if (m.matched_player_id) {
        playerMappings.push({
          sleeper_id: m.sleeper_id,
          player_id: m.matched_player_id,
          position: m.sleeper_team ?? '',
        });
      }
    }

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
      AsyncStorage.removeItem(SLEEPER_STORAGE_KEY).catch(() => {});
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

  // Per-step advance gates — mirrors create-league's `canAdvance` logic.
  const unresolvedCount = (state.previewData?.unmatched_players ?? []).filter(
    p => !state.resolvedMappings.has(p.sleeper_id) && !state.skippedPlayers.has(p.sleeper_id),
  ).length;

  const isOddTeamByeInvalid =
    step === STEP_SEASON &&
    state.wizardState.teams % 2 !== 0 &&
    state.wizardState.regularSeasonWeeks % state.wizardState.teams !== 0;

  const canAdvance = (() => {
    if (step === STEP_PLAYERS) return unresolvedCount === 0;
    if (step === STEP_BASICS) return state.wizardState.name.trim().length > 0;
    if (step === STEP_SEASON) return !isOddTeamByeInvalid;
    return true;
  })();

  const handleCancel = () => {
    if (source === null) {
      router.back();
      return;
    }
    Alert.alert(
      'Exit Import?',
      'Your progress is saved — you can come back and pick up where you left off.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: () => router.back(),
        },
      ],
    );
  };

  // ─── Persistence ─────────────────────────────────────────────
  //
  // Mirrors create-league + screenshot import: try to restore a
  // saved Sleeper-import session on mount, prompt the user to resume
  // vs start over, then begin auto-saving once the choice is made.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SLEEPER_STORAGE_KEY);
        if (!raw || cancelled) {
          hasRestoredRef.current = true;
          return;
        }
        const parsed = JSON.parse(raw) as PersistedSleeperState;
        const hasProgress = !!parsed.sleeperLeagueId?.trim() || !!parsed.previewData;
        if (!hasProgress) {
          await AsyncStorage.removeItem(SLEEPER_STORAGE_KEY);
          hasRestoredRef.current = true;
          return;
        }

        Alert.alert(
          'Resume Import?',
          `You have a saved Sleeper import for "${parsed.wizardState?.name?.trim() || 'Unnamed league'}". Pick up where you left off?`,
          [
            {
              text: 'Start Over',
              style: 'destructive',
              onPress: () => {
                AsyncStorage.removeItem(SLEEPER_STORAGE_KEY).catch(() => {});
                hasRestoredRef.current = true;
              },
            },
            {
              text: 'Resume',
              onPress: () => {
                dispatch({ type: 'HYDRATE', state: deserializeSleeperState(parsed) });
                setStep(parsed.step ?? STEP_FETCH);
                if (parsed.source) setSource(parsed.source);
                hasRestoredRef.current = true;
              },
            },
          ],
        );
      } catch {
        hasRestoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    // Only persist once the user has actually picked Sleeper and
    // typed something — the "Choose Source" screen has nothing
    // worth saving.
    if (source !== 'sleeper') return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const payload = serializeSleeperState(state, step, source);
      AsyncStorage.setItem(SLEEPER_STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
    }, 500);
  }, [state, step, source]);

  // ─── Source selection ──────────────────────────────────────────────

  if (!source) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.headerRow}>
          <BrandButton
            label="Cancel"
            onPress={handleCancel}
            variant="ghost"
            size="default"
            accessibilityLabel="Cancel import"
          />
        </View>

        <View style={styles.sourceIntro}>
          <ThemedText type="sectionLabel" style={styles.sourceHeading} accessibilityRole="header">
            Import League
          </ThemedText>
          <ThemedText style={[styles.sourceSub, { color: c.secondaryText }]}>
            Choose how you'd like to bring in your existing league.
          </ThemedText>
        </View>

        <Section title="Choose Source" cardStyle={styles.sourceCard}>
          <SourceRow
            icon="cloud-download-outline"
            title="Sleeper"
            description="Import directly using your Sleeper league ID. Rosters, settings, and history are pulled automatically."
            onPress={() => setSource('sleeper')}
            index={0}
            total={2}
          />
          <SourceRow
            icon="camera-outline"
            title="Screenshots"
            description="Take screenshots of your league and we'll extract the data for you using AI."
            onPress={() => setSource('screenshots')}
            index={1}
            total={2}
          />
        </Section>
      </ThemedView>
    );
  }

  if (source === 'screenshots') {
    return <ScreenshotImport />;
  }

  // ─── Sleeper wizard ────────────────────────────────────────────────

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerRow}>
        <BrandButton
          label="Cancel"
          onPress={handleCancel}
          variant="ghost"
          size="default"
          accessibilityLabel="Cancel import"
        />
      </View>

      <StepIndicator currentStep={step} steps={STEP_LABELS} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.scrollWrap}>
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.contentInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            onContentSizeChange={handleContentSizeChange}
          >
            {step === STEP_FETCH && (
              <FormSection title="Sleeper League ID">
                <BrandTextInput
                  placeholder="e.g. 784512345678901234"
                  value={state.sleeperLeagueId}
                  onChangeText={v => dispatch({ type: 'SET_SLEEPER_ID', value: v })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  accessibilityLabel="Sleeper league ID"
                  helperText="You can find this in your league URL on Sleeper."
                  errorText={previewMutation.isError ? previewMutation.error?.message : undefined}
                />

                <BrandButton
                  label="Fetch League"
                  onPress={handleFetch}
                  variant="primary"
                  size="default"
                  fullWidth
                  disabled={!state.sleeperLeagueId.trim()}
                  loading={previewMutation.isPending}
                  accessibilityLabel="Fetch league from Sleeper"
                />
              </FormSection>
            )}

            {step === STEP_PLAYERS && state.previewData && (() => {
              const matched = state.previewData.player_matches.length;
              const totalPlayers = matched + state.previewData.unmatched_players.length;
              const matchRate = totalPlayers > 0 ? Math.round((matched / totalPlayers) * 100) : 0;
              const needsReview = (state.previewData.unmatched_players ?? []).filter(
                p => !state.resolvedMappings.has(p.sleeper_id) && !state.skippedPlayers.has(p.sleeper_id),
              ).length;
              return (
                <>
                  {/* Just the match-rate summary at the top — league
                      info / roster / scoring are configured in their
                      own steps downstream, so surfacing them here
                      would be redundant. Teams move to Review. */}
                  <Section title="Player Match">
                    <View style={styles.matchStatsRow}>
                      <View style={styles.matchStat}>
                        <Text style={[styles.matchStatValue, { color: c.text }]}>{matched}</Text>
                        <ThemedText type="varsitySmall" style={[styles.matchStatLabel, { color: c.secondaryText }]}>
                          Matched
                        </ThemedText>
                      </View>
                      <View style={[styles.matchDivider, { backgroundColor: c.border }]} />
                      <View style={styles.matchStat}>
                        <Text
                          style={[
                            styles.matchStatValue,
                            { color: needsReview > 0 ? c.warning : c.text },
                          ]}
                        >
                          {needsReview}
                        </Text>
                        <ThemedText type="varsitySmall" style={[styles.matchStatLabel, { color: c.secondaryText }]}>
                          Need Review
                        </ThemedText>
                      </View>
                      <View style={[styles.matchDivider, { backgroundColor: c.border }]} />
                      <View style={styles.matchStat}>
                        <Text style={[styles.matchStatValue, { color: c.text }]}>{matchRate}%</Text>
                        <ThemedText type="varsitySmall" style={[styles.matchStatLabel, { color: c.secondaryText }]}>
                          Match Rate
                        </ThemedText>
                      </View>
                    </View>
                  </Section>

                  <PlayerMatchList
                    matched={state.previewData.player_matches}
                    unmatched={state.previewData.unmatched_players.filter(
                      p => !state.resolvedMappings.has(p.sleeper_id) && !state.skippedPlayers.has(p.sleeper_id),
                    )}
                    onResolve={handleResolve}
                    onSkip={handleSkip}
                  />
                </>
              );
            })()}

            {step === STEP_BASICS && (
              <StepBasics state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === STEP_ROSTER && (
              <StepRoster
                state={state.wizardState}
                onSlotChange={(i, count) =>
                  dispatch({ type: 'SET_ROSTER_SLOT', index: i, count })
                }
                onChange={handleWizardChange}
                onResetRoster={() => dispatch({ type: 'RESET_ROSTER' })}
              />
            )}

            {step === STEP_SCORING && (
              <StepScoring
                state={state.wizardState}
                onScoringChange={(i, v) =>
                  dispatch({ type: 'SET_SCORING', index: i, value: v })
                }
                onResetScoring={() => dispatch({ type: 'RESET_SCORING' })}
                onScoringTypeChange={v =>
                  dispatch({ type: 'SET_SCORING_TYPE', value: v })
                }
                onCategoryToggle={(i, enabled) =>
                  dispatch({ type: 'SET_CATEGORY_ENABLED', index: i, enabled })
                }
                onResetCategories={() => dispatch({ type: 'RESET_CATEGORIES' })}
              />
            )}

            {step === STEP_WAIVERS && (
              <StepWaivers state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === STEP_SEASON && (
              <StepSeason state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === STEP_TRADE && (
              <StepTrade state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === STEP_DRAFT && (
              <StepDraft state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === STEP_REVIEW && state.previewData && (
              <StepReview
                state={state.wizardState}
                onSubmit={handleImport}
                onBack={() => setStep(s => s - 1)}
                loading={importMutation.isPending}
                submitLabel="Import League"
                headerContent={
                  <>
                    <Section title="Import Summary">
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
                        last
                      />
                    </Section>

                    {/* Teams moved here from the Players step — the
                        full team list is most useful as a "this is
                        what's about to be imported" confirmation, not
                        alongside the player-matching work. */}
                    <Section title={`Teams (${state.previewData.teams.length})`} cardStyle={styles.teamsCard}>
                      {state.previewData.teams.map((team, idx) => (
                        <View
                          key={team.roster_id}
                          style={[
                            styles.teamRow,
                            { borderBottomColor: c.border },
                            idx === state.previewData!.teams.length - 1 && { borderBottomWidth: 0 },
                          ]}
                        >
                          <ThemedText style={[styles.teamName, { color: c.text }]} numberOfLines={1}>
                            {team.team_name}
                          </ThemedText>
                          <Text style={[styles.teamMeta, { color: c.secondaryText }]}>
                            {team.players} players
                          </Text>
                        </View>
                      ))}
                    </Section>
                  </>
                }
              />
            )}
          </ScrollView>

          {hasMoreContent && !isAtBottom && (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(200)}
              style={styles.scrollHint}
              pointerEvents="none"
              accessibilityLabel="Scroll down for more options"
            >
              <Text style={[styles.scrollHintText, { color: c.secondaryText }]}>↓</Text>
            </Animated.View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Navigation. Step 0 uses its own Fetch button inside the form
          (acts as Next). Review step renders its own Back+Import in
          StepReview. Everything in between gets standard Back/Next. */}
      {step > STEP_FETCH && step < STEP_REVIEW && (
        <View style={styles.navRow}>
          <BrandButton
            label="Back"
            onPress={() => setStep(s => s - 1)}
            variant="secondary"
            size="default"
          />
          <BrandButton
            label="Next"
            onPress={() => setStep(s => s + 1)}
            variant="primary"
            size="default"
            disabled={!canAdvance}
            accessibilityLabel={`Next, step ${step + 2} of ${STEP_LABELS.length}`}
          />
        </View>
      )}
    </ThemedView>
  );
}

// ─── Source row ─────────────────────────────────────────────────────

function SourceRow({
  icon,
  title,
  description,
  badge,
  onPress,
  index,
  total,
}: {
  icon: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap;
  title: string;
  description: string;
  badge?: string;
  onPress?: () => void;
  index: number;
  total: number;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const disabled = !onPress;

  return (
    <ListRow
      index={index}
      total={total}
      onPress={onPress}
      accessibilityLabel={`${title}${disabled ? ', coming soon' : ''}`}
      accessibilityHint={disabled ? undefined : 'Tap to continue with this import method'}
      style={[styles.sourceRow, disabled && { opacity: 0.5 }]}
    >
      <View style={[styles.sourceIcon, { backgroundColor: Brand.vintageGold + '22' }]}>
        <Ionicons name={icon} size={ms(22)} color={Brand.vintageGold} accessible={false} />
      </View>
      <View style={styles.sourceBody}>
        <View style={styles.sourceTitleRow}>
          <ThemedText type="sectionLabel" style={[styles.sourceTitle, { color: c.text }]}>
            {title}
          </ThemedText>
          {badge && (
            <View style={[styles.comingSoonBadge, { borderColor: c.border }]}>
              <Text style={[styles.comingSoonText, { color: c.secondaryText }]}>{badge}</Text>
            </View>
          )}
        </View>
        <ThemedText style={[styles.sourceDesc, { color: c.secondaryText }]}>
          {description}
        </ThemedText>
      </View>
      {!disabled && (
        <Ionicons name="chevron-forward" size={ms(16)} color={c.secondaryText} accessible={false} />
      )}
    </ListRow>
  );
}

// Compact summary row for the import-specific preamble of the Review
// step. Uses the same mono value + varsity-small label rhythm as
// StepReview's per-category rows.
function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.summaryRow, last && { paddingBottom: 0 }]}>
      <ThemedText style={[styles.summaryLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <Text style={[styles.summaryValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 54,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginLeft: -s(18),
    marginBottom: 6,
  },
  flex: {
    flex: 1,
  },
  scrollWrap: {
    flex: 1,
    position: 'relative',
  },
  contentInner: {
    paddingBottom: s(24),
  },

  // ─── Source selection ──────────────────────────────────────
  sourceIntro: {
    marginBottom: s(16),
    gap: s(6),
  },
  sourceHeading: {
    fontSize: ms(22),
    letterSpacing: -0.2,
  },
  sourceSub: {
    fontSize: ms(14),
    lineHeight: ms(20),
  },
  sourceCard: {
    paddingHorizontal: 0,
  },
  sourceRow: {
    paddingVertical: s(14),
    gap: s(12),
    alignItems: 'center',
  },
  sourceIcon: {
    width: s(44),
    height: s(44),
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBody: {
    flex: 1,
    gap: s(2),
  },
  sourceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  sourceTitle: {
    fontSize: ms(15),
  },
  sourceDesc: {
    fontSize: ms(12),
    lineHeight: ms(17),
  },
  comingSoonBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  comingSoonText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(8),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ─── Players step: match-rate summary ──────────────────────
  matchStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: s(6),
  },
  matchStat: {
    alignItems: 'center',
    gap: s(4),
    flex: 1,
  },
  matchStatValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(22),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  matchStatLabel: {
    fontSize: ms(10),
    letterSpacing: 0.9,
  },
  matchDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: s(4),
  },

  // ─── Review step: Teams list ────────────────────────────────
  teamsCard: {
    paddingHorizontal: 0,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(10),
    paddingHorizontal: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamName: {
    flex: 1,
    fontSize: ms(14),
    fontWeight: '500',
  },
  teamMeta: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ─── Review ────────────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(5),
    gap: s(12),
  },
  summaryLabel: {
    fontSize: ms(14),
    flexShrink: 1,
  },
  summaryValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'right',
    flexShrink: 1,
  },

  // ─── Scroll hint ────────────────────────────────────────────
  scrollHint: {
    position: 'absolute',
    bottom: s(6),
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scrollHintText: {
    fontSize: ms(16),
    fontWeight: '600',
    opacity: 0.45,
  },

  // ─── Nav row ────────────────────────────────────────────────
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 32,
  },
});

export const options = {
  headerShown: false,
};
