import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { StepBasics } from "@/components/create-league/StepBasics";
import { StepDraft } from "@/components/create-league/StepDraft";
import { StepReview } from "@/components/create-league/StepReview";
import { StepRoster } from "@/components/create-league/StepRoster";
import { StepScoring } from "@/components/create-league/StepScoring";
import { StepSeason, computeMaxWeeks, computeSeasonStart } from "@/components/create-league/StepSeason";
import { StepTrade } from "@/components/create-league/StepTrade";
import { StepWaivers } from "@/components/create-league/StepWaivers";
import { BrandButton } from "@/components/ui/BrandButton";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { ThemedView } from "@/components/ui/ThemedView";
import { Colors } from "@/constants/Colors";
import {
  CURRENT_NBA_SEASON,
  getCurrentSeason,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  INITIAL_DRAFT_ORDER_TO_DB,
  LEAGUE_TYPE_TO_DB,
  LeagueWizardState,
  SCORING_TYPE_TO_DB,
  ScoringTypeOption,
  PLAYER_LOCK_TO_DB,
  SEEDING_TO_DB,
  STEP_LABELS,
  TIEBREAKER_TO_DB,
} from "@/constants/LeagueDefaults";
import { useConfirm } from "@/context/ConfirmProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { generateDraftPicks, generateFutureDraftPicks } from "@/lib/draft";
import { capture } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { calcLotteryPoolSize, defaultPlayoffTeams, getPlayoffTeamOptions } from "@/utils/league/lottery";
import { sanitizeHandle } from "@/utils/league/paymentLinks";
import { logger } from "@/utils/logger";
import { containsBlockedContent } from "@/utils/moderation";
import { ms, s } from "@/utils/scale";

// --- Reducer ---

type Action =
  | { type: "SET_FIELD"; field: keyof LeagueWizardState; value: any }
  | { type: "SET_ROSTER_SLOT"; index: number; count: number }
  | { type: "SET_SCORING"; index: number; value: number }
  | { type: "RESET_SCORING" }
  | { type: "RESET_ROSTER" }
  | { type: "SET_SCORING_TYPE"; value: ScoringTypeOption }
  | { type: "SET_CATEGORY_ENABLED"; index: number; enabled: boolean }
  | { type: "RESET_CATEGORIES" };

const DEFAULT_PLAYOFF_WEEKS = 3;
const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);
const WIZARD_STORAGE_KEY = '@league_wizard';

const initialState: LeagueWizardState = {
  sport: 'nba',
  leagueType: 'Dynasty',
  keeperCount: 5,
  name: "",
  teams: 10,
  isPrivate: false,
  rosterSlots: DEFAULT_ROSTER_SLOTS.map((s) => ({ ...s })),
  scoringType: 'Points',
  scoring: DEFAULT_SCORING.map((s) => ({ ...s })),
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  draftType: "Snake",
  initialDraftOrder: "Random",
  timePerPick: 90,
  maxDraftYears: 3,
  tradeVetoType: "Commissioner",
  tradeReviewPeriodHours: 24,
  tradeVotesToVeto: 4,
  rookieDraftRounds: 2,
  rookieDraftOrder: "Reverse Record",
  lotteryDraws: 4,
  lotteryOdds: null,
  waiverType: "Standard",
  waiverPeriodDays: 2,
  faabBudget: 100,
  waiverDayOfWeek: 3,
  season: CURRENT_NBA_SEASON,
  seasonStartDate: null,
  regularSeasonWeeks: maxWeeks - DEFAULT_PLAYOFF_WEEKS,
  playoffWeeks: DEFAULT_PLAYOFF_WEEKS,
  playoffTeams: defaultPlayoffTeams(DEFAULT_PLAYOFF_WEEKS, 10),
  playoffSeedingFormat: "Standard",
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
};

function clampLotteryState(s: LeagueWizardState): LeagueWizardState {
  // When teams, playoffWeeks, or playoffTeams change, ensure playoffTeams
  // is valid and lotteryDraws doesn't exceed the lottery pool.
  const options = getPlayoffTeamOptions(s.playoffWeeks, s.teams);
  let pt = s.playoffTeams;
  if (!options.includes(pt)) {
    // Pick closest valid option
    pt = options.length > 0
      ? options.reduce((best, o) => (Math.abs(o - pt) < Math.abs(best - pt) ? o : best), options[0])
      : 0;
  }
  const pool = calcLotteryPoolSize(s.teams, pt);
  const draws = pool > 0 ? Math.min(s.lotteryDraws, pool) : 0;
  // Reset custom odds when pool size changes (they'd be the wrong length)
  const odds = s.lotteryOdds && s.lotteryOdds.length !== pool ? null : s.lotteryOdds;
  return { ...s, playoffTeams: pt, lotteryDraws: draws, lotteryOdds: odds };
}

function reducer(state: LeagueWizardState, action: Action): LeagueWizardState {
  switch (action.type) {
    case "SET_FIELD": {
      const next = { ...state, [action.field]: action.value };
      // Re-clamp lottery settings when dependent fields change
      if (action.field === 'teams' || action.field === 'playoffWeeks' || action.field === 'playoffTeams') {
        return clampLotteryState(next);
      }
      // Re-clamp week counts when start date changes
      if (action.field === 'seasonStartDate') {
        const start = action.value
          ? (() => { const [sy, sm, sd] = (action.value as string).split('-').map(Number); return new Date(sy, sm - 1, sd); })()
          : computeSeasonStart();
        const newMax = computeMaxWeeks(next.season, next.sport, start);
        const playoffWeeks = Math.min(next.playoffWeeks, Math.max(1, newMax - 1));
        const regularSeasonWeeks = Math.min(next.regularSeasonWeeks, Math.max(1, newMax - playoffWeeks));
        return clampLotteryState({ ...next, regularSeasonWeeks, playoffWeeks });
      }
      // When switching away from dynasty, disable pick-related features
      if (action.field === 'leagueType' && action.value !== 'Dynasty') {
        return { ...next, draftPickTradingEnabled: false, pickConditionsEnabled: false, maxDraftYears: 0 };
      }
      if (action.field === 'leagueType' && action.value === 'Dynasty') {
        return { ...next, maxDraftYears: 3 };
      }
      // When sport changes, snap the season string to that sport's default and
      // recompute week boundaries from the new season's start date.
      if (action.field === 'sport') {
        const newSport = action.value as 'nba' | 'wnba';
        const newSeason = getCurrentSeason(newSport);
        const newMax = computeMaxWeeks(newSeason, newSport);
        const playoffWeeks = Math.min(next.playoffWeeks, Math.max(1, newMax - 1));
        const regularSeasonWeeks = Math.min(next.regularSeasonWeeks, Math.max(1, newMax - playoffWeeks));
        return clampLotteryState({ ...next, season: newSeason, seasonStartDate: null, regularSeasonWeeks, playoffWeeks });
      }
      return next;
    }
    case "SET_ROSTER_SLOT": {
      const slots = [...state.rosterSlots];
      slots[action.index] = { ...slots[action.index], count: action.count };
      return { ...state, rosterSlots: slots };
    }
    case "SET_SCORING": {
      const scoring = [...state.scoring];
      scoring[action.index] = {
        ...scoring[action.index],
        point_value: action.value,
      };
      return { ...state, scoring };
    }
    case "RESET_SCORING":
      return { ...state, scoring: DEFAULT_SCORING.map((s) => ({ ...s })) };
    case "RESET_ROSTER":
      return {
        ...state,
        rosterSlots: DEFAULT_ROSTER_SLOTS.map((s) => ({ ...s })),
        positionLimits: {},
      };
    case "SET_SCORING_TYPE":
      return { ...state, scoringType: action.value };
    case "SET_CATEGORY_ENABLED": {
      const cats = [...state.categories];
      cats[action.index] = { ...cats[action.index], is_enabled: action.enabled };
      return { ...state, categories: cats };
    }
    case "RESET_CATEGORIES":
      return { ...state, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) };
    default:
      return state;
  }
}

// --- Component ---

export default function CreateLeague() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const confirm = useConfirm();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const hasRestoredRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);
  // Track the ScrollView's viewport height and the rendered content
  // height independently so we can compute "is there more to scroll?"
  // immediately when the step mounts — before the user touches the
  // screen. The previous implementation only computed this on
  // `onScroll`, which meant the hint appeared late (or not at all for
  // steps the user never scrolled).
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);

  // Restore saved wizard progress on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(WIZARD_STORAGE_KEY);
        if (!saved || hasRestoredRef.current) return;
        const { state: savedState, step: savedStep } = JSON.parse(saved);
        if (!savedState?.name) return; // nothing meaningful saved
        confirm({
          title: 'Resume Progress?',
          message: `You have a saved league "${savedState.name}" (step ${savedStep + 1}/${STEP_LABELS.length}). Continue where you left off?`,
          cancelLabel: 'Start Over',
          onCancel: () => {
            AsyncStorage.removeItem(WIZARD_STORAGE_KEY).catch(() => {});
          },
          action: {
            label: 'Resume',
            onPress: () => {
              // Replay saved state into the reducer
              for (const [key, value] of Object.entries(savedState)) {
                dispatch({ type: 'SET_FIELD', field: key as keyof LeagueWizardState, value });
              }
              setStep(savedStep);
            },
          },
        });
        hasRestoredRef.current = true;
      } catch {}
    })();
  }, []);

  // Persist wizard state on every change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistWizard = useCallback((s: LeagueWizardState, currentStep: number) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({ state: s, step: currentStep })).catch((e) =>
        logger.warn('Persist create-league wizard state failed', e),
      );
    }, 500);
  }, []);

  useEffect(() => {
    persistWizard(state, step);
  }, [state, step, persistWizard]);

  // Scroll to top when step changes. Reset the "at bottom" flag but
  // leave `hasMoreContent` for the size-change handlers below to set
  // when the new step's content measures itself — that avoids the
  // old bug where the hint was stuck false until the user scrolled.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setIsAtBottom(false);
  }, [step]);

  // Track wizard step progression
  useEffect(() => {
    if (step > 0) {
      capture('league_wizard_step', { step, step_label: STEP_LABELS[step] });
    }
  }, [step]);

  const recomputeHint = useCallback(() => {
    const viewport = viewportHeightRef.current;
    const content = contentHeightRef.current;
    if (viewport > 0 && content > 0) {
      setHasMoreContent(content > viewport + 20);
    }
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setIsAtBottom(distanceFromBottom < 20);
    // Keep refs in sync in case content changed mid-scroll.
    viewportHeightRef.current = layoutMeasurement.height;
    contentHeightRef.current = contentSize.height;
    recomputeHint();
  }, [recomputeHint]);

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

  // Steps: 0=Basics, 1=Roster, 2=Scoring, 3=Waivers, 4=Season, 5=Trade, 6=Draft, 7=Review
  const TOTAL_STEPS = STEP_LABELS.length;
  const isOddTeamByeInvalid =
    step === 4 &&
    state.teams % 2 !== 0 &&
    state.regularSeasonWeeks % state.teams !== 0;
  const canAdvance =
    step === 0 ? state.name.trim().length > 0 : !isOddTeamByeInvalid;

  const handleChange = (field: keyof LeagueWizardState, value: any) => {
    dispatch({ type: "SET_FIELD", field, value });
  };

  const handleCreateLeague = async () => {
    if (containsBlockedContent(state.name)) {
      Alert.alert('Invalid name', 'That league name contains language that isn\u2019t allowed.');
      return;
    }
    setLoading(true);

    const user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      Alert.alert("User not logged in.");
      setLoading(false);
      return;
    }

    const rosterSize = state.rosterSlots.reduce((sum, s) => (s.position === 'IR' || s.position === 'TAXI') ? sum : sum + s.count, 0);
    const taxiSlotCount = state.rosterSlots.find((s) => s.position === 'TAXI')?.count ?? 0;

    // Use custom start date if set, otherwise compute automatically
    let seasonStart: Date;
    if (state.seasonStartDate) {
      const [sy, sm, sd] = state.seasonStartDate.split('-').map(Number);
      seasonStart = new Date(sy, sm - 1, sd);
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dow = today.getDay(); // 0=Sun
      const daysSinceMon = dow === 0 ? 6 : dow - 1;
      const daysLeft = 7 - daysSinceMon;
      seasonStart = today;
      if (daysLeft < 5) {
        seasonStart = new Date(today);
        seasonStart.setDate(today.getDate() + (7 - daysSinceMon));
      }
    }
    const seasonStartDate = `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, "0")}-${String(seasonStart.getDate()).padStart(2, "0")}`;

    const isDynasty = state.leagueType === 'Dynasty';

    // 1. Create league
    const { data: leagueData, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        name: state.name,
        created_by: user.id,
        sport: state.sport,
        league_type: LEAGUE_TYPE_TO_DB[state.leagueType],
        keeper_count: state.leagueType === 'Keeper' ? state.keeperCount : null,
        max_future_seasons: isDynasty ? state.maxDraftYears : 0,
        teams: state.teams,
        roster_size: rosterSize,
        private: state.isPrivate,
        season: state.season,
        regular_season_weeks: state.regularSeasonWeeks,
        playoff_weeks: state.playoffWeeks,
        season_start_date: seasonStartDate,
        trade_review_period_hours: state.tradeVetoType === 'None' ? 0 : state.tradeReviewPeriodHours,
        trade_veto_type: state.tradeVetoType === 'Commissioner'
          ? 'commissioner'
          : state.tradeVetoType === 'League Vote'
            ? 'league_vote'
            : 'none',
        trade_votes_to_veto: state.tradeVotesToVeto,
        rookie_draft_rounds: isDynasty ? state.rookieDraftRounds : 0,
        rookie_draft_order: isDynasty
          ? (state.rookieDraftOrder === 'Reverse Record' ? 'reverse_record' : 'lottery')
          : 'reverse_record',
        lottery_draws: isDynasty ? state.lotteryDraws : 0,
        lottery_odds: isDynasty ? state.lotteryOdds : null,
        playoff_teams: state.playoffTeams,
        waiver_type: state.waiverType === 'Standard'
          ? 'standard'
          : state.waiverType === 'FAAB'
            ? 'faab'
            : 'none',
        waiver_period_days: state.waiverType === 'None' ? 0 : state.waiverPeriodDays,
        faab_budget: state.faabBudget,
        waiver_day_of_week: state.waiverDayOfWeek,
        playoff_seeding_format: SEEDING_TO_DB[state.playoffSeedingFormat] ?? 'standard',
        reseed_each_round: state.reseedEachRound,
        scoring_type: SCORING_TYPE_TO_DB[state.scoringType] ?? 'points',
        buy_in_amount: state.buyIn || null,
        venmo_username: sanitizeHandle(state.venmoUsername) || null,
        cashapp_tag: sanitizeHandle(state.cashappTag) || null,
        paypal_username: sanitizeHandle(state.paypalUsername) || null,
        taxi_slots: taxiSlotCount,
        taxi_max_experience: taxiSlotCount > 0 ? state.taxiMaxExperience : null,
        weekly_acquisition_limit: state.weeklyAcquisitionLimit,
        player_lock_type: PLAYER_LOCK_TO_DB[state.playerLockType],
        pick_conditions_enabled: isDynasty ? state.pickConditionsEnabled : false,
        draft_pick_trading_enabled: isDynasty ? state.draftPickTradingEnabled : false,
        initial_draft_order: INITIAL_DRAFT_ORDER_TO_DB[state.initialDraftOrder],
        auto_rumors_enabled: state.autoRumorsEnabled,
        tiebreaker_order: TIEBREAKER_TO_DB[state.tiebreakerPrimary],
        division_count: state.divisionCount,
        division_1_name: state.divisionCount === 2 ? state.division1Name.trim() || 'Division 1' : 'Division 1',
        division_2_name: state.divisionCount === 2 ? state.division2Name.trim() || 'Division 2' : 'Division 2',
        position_limits: Object.keys(state.positionLimits).length > 0 ? state.positionLimits : null,
        trade_deadline: state.tradeDeadlineWeek > 0
          ? (() => {
              // Week 1 ends on the first Sunday after (or on) seasonStart.
              // Each subsequent week adds 7 days.
              const start = new Date(seasonStart);
              const dayOfWeek = start.getDay(); // 0=Sun
              const daysToFirstSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
              const week1End = new Date(start);
              week1End.setDate(start.getDate() + daysToFirstSunday);
              const deadlineDate = new Date(week1End);
              deadlineDate.setDate(week1End.getDate() + (state.tradeDeadlineWeek - 1) * 7);
              return `${deadlineDate.getFullYear()}-${String(deadlineDate.getMonth() + 1).padStart(2, '0')}-${String(deadlineDate.getDate()).padStart(2, '0')}`;
            })()
          : null,
      })
      .select()
      .single();

    if (leagueError) {
      logger.error('Create league insert failed', leagueError);
      // Per-user cap trigger and other constraint violations surface
      // human-readable messages — show them rather than swallowing into a
      // generic alert.
      const friendly = (leagueError as any).code === '23514' || /maximum of \d+ leagues/i.test(leagueError.message)
        ? leagueError.message
        : 'Failed to create league.';
      Alert.alert(friendly);
      setLoading(false);
      return;
    }

    // 2. Insert roster config
    const rosterRows = state.rosterSlots
      .filter((s) => s.count > 0)
      .map((s) => ({
        league_id: leagueData.id,
        position: s.position,
        slot_count: s.count,
      }));

    const { error: rosterError } = await supabase
      .from("league_roster_config")
      .insert(rosterRows);

    if (rosterError) {
      logger.error('League roster config insert failed', rosterError);
      Alert.alert("League created but failed to save roster config.");
    }

    // 3. Insert scoring settings
    const scoringRows = state.scoringType === 'Points'
      ? state.scoring.map((s) => ({
          league_id: leagueData.id,
          stat_name: s.stat_name,
          point_value: s.point_value,
          is_enabled: true,
          inverse: false,
        }))
      : state.categories
          .filter((c) => c.is_enabled)
          .map((c) => ({
            league_id: leagueData.id,
            stat_name: c.stat_name,
            point_value: 0,
            is_enabled: true,
            inverse: c.inverse,
          }));

    const { error: scoringError } = await supabase
      .from("league_scoring_settings")
      .insert(scoringRows);

    if (scoringError) {
      logger.error('League scoring settings insert failed', scoringError);
      Alert.alert("League created but failed to save scoring settings.");
    }

    // 4. Create the initial draft
    const { data: draftData, error: draftError } = await supabase
      .from("drafts")
      .insert({
        league_id: leagueData.id,
        season: state.season,
        type: "initial",
        status: "unscheduled",
        rounds: rosterSize,
        picks_per_round: state.teams,
        time_limit: state.timePerPick,
        draft_type: state.draftType.toLowerCase(),
      })
      .select()
      .single();

    if (draftError) {
      logger.error('Initial draft insert failed', draftError);
      Alert.alert("League created but failed to create draft.");
      setLoading(false);
      return;
    }

    // 5. Generate draft picks (+ future tradeable picks for dynasty only)
    const pickPromises: Promise<any>[] = [
      generateDraftPicks(
        draftData.id,
        state.teams,
        rosterSize,
        state.season,
        leagueData.id,
        state.draftType.toLowerCase() as "snake" | "linear",
      ),
    ];
    if (isDynasty) {
      pickPromises.push(
        generateFutureDraftPicks(
          leagueData.id,
          state.teams,
          state.rookieDraftRounds,
          state.season,
          state.maxDraftYears,
        ),
      );
    }
    // allSettled so one generator failing doesn't cancel the others — we still want
    // the partial league to exist so the user can navigate in and recover.
    Promise.allSettled(pickPromises).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        logger.error('Error generating draft picks', undefined, {
          reasons: failed.map((f) => String((f as PromiseRejectedResult).reason)),
        });
      }
    });

    AsyncStorage.removeItem(WIZARD_STORAGE_KEY).catch((e) =>
      logger.warn('Clear create-league wizard storage failed', e),
    );

    capture('league_created', {
      league_type: state.leagueType,
      teams: state.teams,
      scoring_type: state.scoringType,
    });

    setLoading(false);
    router.replace({
      pathname: "/create-team",
      params: {
        leagueId: leagueData.id,
        isCommissioner: "true",
      },
    });
  };

  const handleCancel = () => {
    confirm({
      title: 'Exit League Creation?',
      message: 'Your progress has been saved and you can resume later.',
      cancelLabel: 'Keep Editing',
      action: { label: 'Exit', destructive: true, onPress: () => router.back() },
    });
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerRow}>
        <BrandButton
          label="Cancel"
          onPress={handleCancel}
          variant="ghost"
          size="default"
          accessibilityLabel="Cancel league creation"
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
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSizeChange}
      >
        {step === 0 && <StepBasics state={state} onChange={handleChange} />}
        {step === 1 && (
          <StepRoster
            state={state}
            onSlotChange={(i, count) =>
              dispatch({ type: "SET_ROSTER_SLOT", index: i, count })
            }
            onChange={handleChange}
            onResetRoster={() => dispatch({ type: "RESET_ROSTER" })}
          />
        )}
        {step === 2 && (
          <StepScoring
            state={state}
            onScoringChange={(i, v) =>
              dispatch({ type: "SET_SCORING", index: i, value: v })
            }
            onResetScoring={() => dispatch({ type: "RESET_SCORING" })}
            onScoringTypeChange={(v) =>
              dispatch({ type: "SET_SCORING_TYPE", value: v })
            }
            onCategoryToggle={(i, enabled) =>
              dispatch({ type: "SET_CATEGORY_ENABLED", index: i, enabled })
            }
            onResetCategories={() => dispatch({ type: "RESET_CATEGORIES" })}
          />
        )}
        {step === 3 && <StepWaivers state={state} onChange={handleChange} />}
        {step === 4 && <StepSeason state={state} onChange={handleChange} />}
        {step === 5 && <StepTrade state={state} onChange={handleChange} />}
        {step === 6 && <StepDraft state={state} onChange={handleChange} />}
        {step === 7 && (
          <StepReview
            state={state}
            onSubmit={handleCreateLeague}
            onBack={() => setStep((s) => s - 1)}
            loading={loading}
          />
        )}
      </ScrollView>
      {/* Scroll hint overlays the ScrollView's bottom edge so it
          always sits right against the visible content boundary —
          no matter the viewport height or how much the content
          overflows. Subtle down-arrow; the previous "Scroll for
          more" text was too prominent and the absolute positioning
          kept landing it above the visible area. */}
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

      {step < TOTAL_STEPS - 1 && (
        <View style={styles.navRow}>
          {step > 0 ? (
            <BrandButton
              label="Back"
              onPress={() => setStep((s) => s - 1)}
              variant="secondary"
              size="default"
            />
          ) : (
            <View />
          )}
          <BrandButton
            label="Next"
            onPress={() => setStep((s) => s + 1)}
            variant="primary"
            size="default"
            disabled={!canAdvance}
            accessibilityLabel={`Next, step ${step + 2} of ${TOTAL_STEPS}`}
          />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 54,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    // Negative margin pulls the ghost button's internal padding back
    // so its label sits flush with the content edge (matches where
    // Section-card text starts below, not indented by the button's
    // own padding).
    marginLeft: -s(18),
    marginBottom: 6,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: 24,
  },
  scrollWrap: {
    flex: 1,
    position: "relative",
  },
  scrollHint: {
    position: "absolute",
    bottom: s(6),
    left: 0,
    right: 0,
    alignItems: "center",
  },
  scrollHintText: {
    fontSize: ms(16),
    fontWeight: "600",
    opacity: 0.45,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 32,
  },
});

export const options = {
  headerShown: false,
};
