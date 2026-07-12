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
import { StepSeason } from "@/components/create-league/StepSeason";
import { StepTrade } from "@/components/create-league/StepTrade";
import { StepWaivers } from "@/components/create-league/StepWaivers";
import { BrandButton } from "@/components/ui/BrandButton";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { ThemedView } from "@/components/ui/ThemedView";
import { WizardShell } from "@/components/web/WizardShell";
import { WizardSummary } from "@/components/web/WizardSummary";
import { Colors } from "@/constants/Colors";
import {
  canBypassCreationWindow,
  CURRENT_NBA_SEASON,
  defaultTradeDeadlineWeek,
  defaultVotesToVeto,
  getCreationStatus,
  getCurrentSeason,
  getDefaultRosterSlots,
  getMaxPlayoffWeeks,
  getMaxRookieDraftRounds,
  getSeasonStart,
  DEFAULT_CATEGORIES,
  DEFAULT_SCORING,
  INITIAL_DRAFT_ORDER_TO_DB,
  LEAGUE_TYPE_TO_DB,
  LeagueWizardState,
  SCORING_TYPE_TO_DB,
  ScoringTypeOption,
  PLAYER_LOCK_TO_DB,
  FAAB_TIEBREAK_TO_DB,
  SEEDING_TO_DB,
  WAIVER_PRIORITY_RESET_TO_DB,
  SPORT_OPTIONS,
  SPORT_TO_DB,
  STEP_LABELS,
  TIEBREAKER_TO_DB,
  type Sport,
} from "@/constants/LeagueDefaults";
import { useSession } from "@/context/AuthProvider";
import { useConfirm } from "@/context/ConfirmProvider";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { SportThemeProvider } from "@/hooks/useColors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { buildDraftPicks, buildFutureDraftPicks } from "@/lib/draft";
import { capture } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { Json } from "@/types/database.types";
import { isSlowClock } from "@/utils/draft/pickClock";
import { clampLotteryState, defaultPlayoffSetup, maxPlayoffWeeksForTeams } from "@/utils/league/lottery";
import { sanitizeHandle } from "@/utils/league/paymentLinks";
import { earliestSeasonStart } from "@/utils/league/seasonStart";
import {
  applyCupWeekToggle,
  computeMaxWeeks,
  defaultSeasonStart,
  deriveTradeDeadlineDate,
  deriveTradeDeadlineWeek,
} from "@/utils/league/seasonWeeks";
import { logger } from "@/utils/logger";
import { containsBlockedContent } from "@/utils/moderation";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import { ms, s } from "@/utils/scale";
import { getSportModule } from "@/utils/sports/registry";

// --- Reducer ---

type Action =
  | { type: "SET_FIELD"; field: keyof LeagueWizardState; value: any }
  | { type: "SET_ROSTER_SLOT"; index: number; count: number }
  | { type: "SET_SCORING"; index: number; value: number }
  | { type: "RESET_SCORING" }
  | { type: "SET_SCORING_PRESET"; key: string }
  | { type: "RESET_ROSTER" }
  | { type: "SET_SCORING_TYPE"; value: ScoringTypeOption }
  | { type: "SET_CATEGORY_ENABLED"; index: number; enabled: boolean }
  | { type: "RESET_CATEGORIES" };

const DEFAULT_TEAMS = 10;
const maxWeeks = computeMaxWeeks(CURRENT_NBA_SEASON);
// Teams-first defaults: 10 teams → 6 playoff teams over 3 weeks. Recomputed
// by the reducer whenever teams / season / sport change.
const PLAYOFF_DEFAULTS = defaultPlayoffSetup(DEFAULT_TEAMS, maxWeeks);
// Floor at 1: when the current season is fully past its end date,
// computeMaxWeeks returns 1, and naive subtraction here used to produce -2
// (rendered as a broken stepper). The wizard mount logic auto-switches
// the user to an actually-creatable season, but this is the safety belt
// while the module-level constants are being read.
const DEFAULT_REG_SEASON_WEEKS = Math.max(1, maxWeeks - PLAYOFF_DEFAULTS.playoffWeeks);
const WIZARD_STORAGE_KEY = '@league_wizard';

const initialState: LeagueWizardState = {
  sport: 'nba',
  leagueType: 'Dynasty',
  keeperCount: 5,
  name: "",
  teams: DEFAULT_TEAMS,
  isPrivate: false,
  rosterSlots: getDefaultRosterSlots('nba'),
  scoringType: 'Points',
  scoring: DEFAULT_SCORING.map((s) => ({ ...s })),
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  draftType: "Snake",
  initialDraftOrder: "Random",
  timePerPick: 90,
  accelerateAfterRound: null,
  acceleratedTimePerPick: 30,
  maxDraftYears: 3,
  tradeVetoType: "League Vote",
  tradeReviewPeriodHours: 24,
  tradeVotesToVeto: defaultVotesToVeto(DEFAULT_TEAMS),
  rookieDraftRounds: 2,
  rookieDraftOrder: "Reverse Record",
  lotteryDraws: 4,
  lotteryOdds: null,
  waiverType: "Standard",
  waiverPeriodDays: 2,
  faabBudget: 100,
  waiverPriorityReset: "Reverse Standings",
  faabTiebreak: "Earliest Bid",
  season: CURRENT_NBA_SEASON,
  seasonStartDate: null,
  regularSeasonWeeks: DEFAULT_REG_SEASON_WEEKS,
  playoffWeeks: PLAYOFF_DEFAULTS.playoffWeeks,
  combineCupWeek: false,
  playoffTeams: PLAYOFF_DEFAULTS.playoffTeams,
  playoffSeedingFormat: "Standard",
  pickConditionsEnabled: false,
  draftPickTradingEnabled: false,
  tradeDeadlineWeek: defaultTradeDeadlineWeek(DEFAULT_REG_SEASON_WEEKS),
  tradeDeadlineDate: deriveTradeDeadlineDate({
    sport: 'nba',
    season: CURRENT_NBA_SEASON,
    seasonStartDate: null,
    regularSeasonWeeks: DEFAULT_REG_SEASON_WEEKS,
    tradeDeadlineWeek: defaultTradeDeadlineWeek(DEFAULT_REG_SEASON_WEEKS),
    combineCupWeek: false,
  }),
  buyIn: 0,
  venmoUsername: '',
  cashappTag: '',
  paypalUsername: '',
  taxiMaxExperience: 1,
  weeklyAcquisitionLimit: null,
  playerLockType: 'Daily',
  autoRumorsEnabled: true,
  tiebreakerPrimary: 'Head-to-Head',
  divisionCount: 1,
  division1Name: 'Division 1',
  division2Name: 'Division 2',
  positionLimits: {},
};

/** Parse a 'YYYY-MM-DD' string to a local-midnight Date. */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The default start for a (sport, season): its hardcoded opening night when
// that's still in the future, otherwise null so the wizard falls back to
// defaultSeasonStart() (tomorrow) for mid-season / past-opener creation.
// Anchoring to opening night keeps week math measuring the real season window
// instead of counting from today for a season that hasn't tipped off yet —
// without it a future season defaults to far more weeks than the season
// actually has.
function seasonStartDefault(sport: Sport, season: string): { date: Date; iso: string | null } {
  const opening = getSeasonStart(sport, season);
  if (opening) {
    const openDate = new Date(`${opening}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (openDate > today) return { date: openDate, iso: opening };
  }
  return { date: defaultSeasonStart(sport, season), iso: null };
}

function reducer(state: LeagueWizardState, action: Action): LeagueWizardState {
  switch (action.type) {
    case "SET_FIELD": {
      const next = { ...state, [action.field]: action.value };
      // Re-clamp lottery settings when dependent fields change
      if (action.field === 'teams' || action.field === 'playoffWeeks' || action.field === 'playoffTeams') {
        // Votes-to-veto is bounded by teams-1. Without this clamp, lowering
        // teams below the stale votesToVeto value leaves the stepper sitting
        // at its (now-greyed) max, which reads as "I lowered it and it went
        // to the highest" when the user lands on the Trade step.
        const votesMax = Math.max(1, next.teams - 1);
        const tradeVotesToVeto = Math.min(next.tradeVotesToVeto, votesMax);
        // Rookie draft rounds are capped by rookie pool / teams, so growing
        // teams can push the stored value above the new max.
        const rookieDraftRounds = Math.min(
          next.rookieDraftRounds,
          getMaxRookieDraftRounds(next.sport, next.teams),
        );
        // A shrinking league can no longer fill its playoff bracket — cap the
        // weeks at what the team count supports (2 teams = a 1-week final),
        // else the schedule ends with playoff weeks the engine never fills.
        const playoffWeeks = Math.min(next.playoffWeeks, maxPlayoffWeeksForTeams(next.teams));
        let regularSeasonWeeks = next.regularSeasonWeeks;
        if (playoffWeeks !== next.playoffWeeks) {
          // Give the freed playoff weeks back to the regular season when it
          // was already filling the calendar (the default); a deliberately
          // shorter season is left alone.
          const start = next.seasonStartDate
            ? ymdToDate(next.seasonStartDate)
            : defaultSeasonStart(next.sport, next.season);
          const maxTotal = computeMaxWeeks(next.season, next.sport, start, next.combineCupWeek ?? false);
          if (state.regularSeasonWeeks >= maxTotal - state.playoffWeeks) {
            regularSeasonWeeks = Math.max(1, maxTotal - playoffWeeks);
          }
        }
        return clampLotteryState({ ...next, tradeVotesToVeto, rookieDraftRounds, playoffWeeks, regularSeasonWeeks });
      }
      // Toggling the NBA Cup double week consumes/frees one calendar week —
      // the shared helper re-fits the week counts (see applyCupWeekToggle).
      if (action.field === 'combineCupWeek') {
        const toggled = applyCupWeekToggle(next, state);
        return { ...toggled, tradeDeadlineDate: deriveTradeDeadlineDate(toggled) };
      }
      // Re-clamp week counts when start date changes
      if (action.field === 'seasonStartDate') {
        const start = action.value
          ? ymdToDate(action.value as string)
          : defaultSeasonStart(next.sport, next.season);
        const newMax = computeMaxWeeks(next.season, next.sport, start, next.combineCupWeek ?? false);
        const playoffWeeks = Math.min(next.playoffWeeks, Math.max(1, newMax - 1));
        const regularSeasonWeeks = Math.min(next.regularSeasonWeeks, Math.max(1, newMax - playoffWeeks));
        // Trade deadline week can't exceed the new regular season length.
        const tradeDeadlineWeek = next.tradeDeadlineWeek > 0
          ? Math.min(next.tradeDeadlineWeek, regularSeasonWeeks)
          : 0;
        const merged = clampLotteryState({ ...next, regularSeasonWeeks, playoffWeeks, tradeDeadlineWeek });
        return { ...merged, tradeDeadlineDate: deriveTradeDeadlineDate(merged) };
      }
      // When the season changes — the mount auto-switch to a creatable season,
      // or the user picking a different year — refill the schedule to the new
      // season's full window. A fresh calendar means we default to as many
      // regular-season weeks as fit rather than carrying over a stale count
      // (the module-level default floors to 1 once the current season ends).
      if (action.field === 'season') {
        // Keep a custom start date; otherwise anchor to the new season's
        // opening night (future) so weeks measure the real window, not today.
        const fallback = seasonStartDefault(next.sport, next.season);
        const seasonStartDate = next.seasonStartDate ?? fallback.iso;
        const start = seasonStartDate ? new Date(`${seasonStartDate}T00:00:00`) : fallback.date;
        const newMax = computeMaxWeeks(next.season, next.sport, start, next.combineCupWeek ?? false);
        const playoffWeeks = Math.min(next.playoffWeeks, Math.max(1, newMax - 1));
        const regularSeasonWeeks = Math.max(1, newMax - playoffWeeks);
        const tradeDeadlineWeek = next.tradeDeadlineWeek > 0
          ? defaultTradeDeadlineWeek(regularSeasonWeeks)
          : 0;
        const merged = clampLotteryState({ ...next, seasonStartDate, regularSeasonWeeks, playoffWeeks, tradeDeadlineWeek });
        return { ...merged, tradeDeadlineDate: deriveTradeDeadlineDate(merged) };
      }
      // Trade deadline week is bounded by regularSeasonWeeks; the persisted
      // date is re-derived so it can't outlive the shortened season.
      if (action.field === 'regularSeasonWeeks' && next.tradeDeadlineWeek > 0) {
        const tradeDeadlineWeek = Math.min(next.tradeDeadlineWeek, next.regularSeasonWeeks);
        return {
          ...next,
          tradeDeadlineWeek,
          tradeDeadlineDate: deriveTradeDeadlineDate({ ...next, tradeDeadlineWeek }),
        };
      }
      // The "Deadline Week" shortcut was moved directly — re-derive the
      // persisted date (also handles the on/off toggle, which sets this
      // field to 0 or a default week).
      if (action.field === 'tradeDeadlineWeek') {
        return { ...next, tradeDeadlineDate: deriveTradeDeadlineDate(next) };
      }
      // The exact "Deadline Date" was fine-tuned — snap the week stepper to
      // the week that contains it so the two controls never disagree.
      if (action.field === 'tradeDeadlineDate') {
        return { ...next, tradeDeadlineWeek: deriveTradeDeadlineWeek(next) };
      }
      // When switching away from dynasty, disable pick-related features and
      // clear any taxi slots — taxi is dynasty-only (you stash kept prospects).
      if (action.field === 'leagueType' && action.value !== 'Dynasty') {
        return {
          ...next,
          draftPickTradingEnabled: false,
          pickConditionsEnabled: false,
          maxDraftYears: 0,
          rosterSlots: next.rosterSlots.map((slot) =>
            slot.position === ROSTER_SLOT.TAXI ? { ...slot, count: 0 } : slot,
          ),
        };
      }
      if (action.field === 'leagueType' && action.value === 'Dynasty') {
        return { ...next, maxDraftYears: 3 };
      }
      // When sport changes, snap the season string to that sport's default,
      // swap the roster template (WNBA leagues have G/F/C only — no
      // PG/SG/SF/PF), and recompute week boundaries from the new season's
      // start date. Position limits reset because the keys differ per sport.
      if (action.field === 'sport') {
        const newSport = action.value as 'nba' | 'wnba' | 'nfl';
        const newModule = getSportModule(newSport);
        // Snap to the sport's currently-creatable season (current or next,
        // per the calendar gate), falling through to the bare current
        // season for the dev-bypass case where it's calendar-closed.
        const status = getCreationStatus(newSport);
        const newSeason = status.season ?? getCurrentSeason(newSport);
        // For a gated (future) season getCreationStatus returns no start date;
        // anchor to opening night so week math reflects the real season window.
        const fallback = seasonStartDefault(newSport, newSeason);
        const newStartDate = status.defaultStartDate ?? fallback.iso;
        const startDate = newStartDate ? new Date(`${newStartDate}T00:00:00`) : fallback.date;
        const newMax = computeMaxWeeks(newSeason, newSport, startDate, next.combineCupWeek ?? false);
        // Playoff weeks are bounded by the remaining season length, the
        // sport's structural max (NBA 4, WNBA 3), and the team count's
        // bracket support. NBA→WNBA can leave a stale 4-week playoff
        // exceeding the new sport's cap.
        const playoffWeeks = Math.min(
          next.playoffWeeks,
          getMaxPlayoffWeeks(newSport),
          maxPlayoffWeeksForTeams(next.teams),
          Math.max(1, newMax - 1),
        );
        // A sport switch resets the calendar, so fill the new season's window:
        // default to as many regular-season weeks as fit after playoffs rather
        // than carrying over the previous sport's (possibly stale) count.
        const regularSeasonWeeks = Math.max(1, newMax - playoffWeeks);
        // WNBA's rookie pool is smaller, so switching from NBA can push
        // rookieDraftRounds above the new sport's per-teams cap.
        const rookieDraftRounds = Math.min(
          next.rookieDraftRounds,
          getMaxRookieDraftRounds(newSport, next.teams),
        );
        // Re-derive the trade deadline default off the new season length when
        // it's enabled (the carried-over value tracks the old, often stale, count).
        const tradeDeadlineWeek = next.tradeDeadlineWeek > 0
          ? defaultTradeDeadlineWeek(regularSeasonWeeks)
          : 0;
        const merged = clampLotteryState({
          ...next,
          season: newSeason,
          seasonStartDate: newStartDate,
          regularSeasonWeeks,
          playoffWeeks,
          rookieDraftRounds,
          tradeDeadlineWeek,
          rosterSlots: getDefaultRosterSlots(newSport),
          positionLimits: {},
          // Scoring stat names differ per sport (PTS/REB vs PASS_YD/REC), so a
          // sport switch swaps the whole scoring sheet for the new sport's
          // default (NFL = Half-PPR preset). Categories are basketball-only:
          // force Points scoring for sports without them. NFL locks default to
          // per-player ("individual") — games are weekly, a daily lock is
          // meaningless.
          scoring: newModule.defaultScoring.map((s) => ({ ...s })),
          scoringType: (newModule.supportsCategories ? next.scoringType : 'Points') as ScoringTypeOption,
          playerLockType: (newSport === 'nfl' ? 'Individual' : 'Daily') as LeagueWizardState['playerLockType'],
        });
        return { ...merged, tradeDeadlineDate: deriveTradeDeadlineDate(merged) };
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
      return {
        ...state,
        scoring: getSportModule(state.sport).defaultScoring.map((s) => ({ ...s })),
      };
    case "SET_SCORING_PRESET": {
      // NFL Standard / Half-PPR / Full-PPR presets from the registry. No-op
      // for sports without presets.
      const preset = getSportModule(state.sport).scoringPresets?.[action.key];
      if (!preset) return state;
      return { ...state, scoring: preset.map((s) => ({ ...s })) };
    }
    case "RESET_ROSTER":
      return {
        ...state,
        rosterSlots: getDefaultRosterSlots(state.sport),
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
  const { isDesktop } = useBreakpoint();
  const confirm = useConfirm();

  const session = useSession();
  const bypassOpenDate = canBypassCreationWindow(session?.user?.id);

  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const hasRestoredRef = useRef(false);
  const hasInitializedSportRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);

  // Auto-pick the first available sport (and pre-fill seasonStartDate +
  // season) on first mount, BEFORE the saved-progress restore prompt
  // fires. If the initialState's sport (nba) is gated and we have an
  // available alternative (wnba), swap to it. Skip when the user has
  // already typed a name — that's the cue they're past the first step.
  useEffect(() => {
    if (hasInitializedSportRef.current) return;
    if (state.name) return; // saved state being restored
    hasInitializedSportRef.current = true;

    const today = new Date();
    const statusForSelected = getCreationStatus(state.sport, today, { bypassOpenDate });
    if (statusForSelected.available) {
      // Selected sport is fine — just prefill the start date if missing.
      if (!state.seasonStartDate && statusForSelected.defaultStartDate) {
        dispatch({ type: 'SET_FIELD', field: 'seasonStartDate', value: statusForSelected.defaultStartDate });
      }
      if (statusForSelected.season && statusForSelected.season !== state.season) {
        dispatch({ type: 'SET_FIELD', field: 'season', value: statusForSelected.season });
      }
      return;
    }

    // Selected sport gated — try the others in order. Never auto-pick NFL:
    // its tile is admin-gated (useIsAdmin), so landing on it silently would
    // strand non-admins on a sport they can't see or create.
    for (const label of SPORT_OPTIONS) {
      if (label === 'NFL') continue;
      const candidate: Sport = SPORT_TO_DB[label];
      if (candidate === state.sport) continue;
      const status = getCreationStatus(candidate, today, { bypassOpenDate });
      if (status.available) {
        dispatch({ type: 'SET_FIELD', field: 'sport', value: candidate });
        return;
      }
    }
    // No sport available — leave state alone; StepBasics will show the
    // gated tiles and the user can wait for a window to open.
  }, [state.name, state.sport, state.season, state.seasonStartDate, bypassOpenDate]);
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

  // Dead-zone of 48px on both edges so micro-fluctuations in content size
  // (font metrics settling, KeyboardAvoidingView reflows, etc.) don't flip
  // hasMoreContent/isAtBottom back-and-forth and trigger a fade-in/out loop.
  const recomputeHint = useCallback(() => {
    const viewport = viewportHeightRef.current;
    const content = contentHeightRef.current;
    if (viewport > 0 && content > 0) {
      setHasMoreContent(content > viewport + 48);
    }
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setIsAtBottom(distanceFromBottom < 48);
  }, []);

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

    const rosterSize = state.rosterSlots.reduce((sum, s) => (s.position === 'IR' || s.position === ROSTER_SLOT.TAXI) ? sum : sum + s.count, 0);
    const taxiSlotCount = state.rosterSlots.find((s) => s.position === ROSTER_SLOT.TAXI)?.count ?? 0;

    // Use the custom start date if set, otherwise the wizard default
    // (tomorrow, floored to opening night — week1Length absorbs whatever
    // leading days fall before the first Sunday, so no weekday-snapping is
    // needed here). The floor also re-applies to a custom date: the picker
    // enforces it live, but a date persisted before the floor existed (resume
    // flow) could otherwise start a league months before real games exist.
    let seasonStart = state.seasonStartDate
      ? ymdToDate(state.seasonStartDate)
      : defaultSeasonStart(state.sport, state.season);
    const earliestStart = earliestSeasonStart(state.sport, state.season);
    let seasonStartDate = `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, "0")}-${String(seasonStart.getDate()).padStart(2, "0")}`;
    if (seasonStartDate < earliestStart) {
      seasonStartDate = earliestStart;
      seasonStart = ymdToDate(earliestStart);
    }

    const isDynasty = state.leagueType === 'Dynasty';

    // Final clamp on season length. The steppers enforce min=1 on user
    // interaction, but a value replayed from saved wizard progress (resume
    // flow) bypasses that — a stale negative count persisted before the
    // computeMaxWeeks floor existed could otherwise reach the DB and silently
    // break schedule generation (zero matchups). Belt to the stepper's braces.
    const regularSeasonWeeks = Math.max(1, state.regularSeasonWeeks);
    const playoffWeeks = Math.max(0, state.playoffWeeks);

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
        regular_season_weeks: regularSeasonWeeks,
        playoff_weeks: playoffWeeks,
        combine_cup_week: state.sport === 'nba' ? (state.combineCupWeek ?? false) : false,
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
        waiver_priority_reset: WAIVER_PRIORITY_RESET_TO_DB[state.waiverPriorityReset],
        faab_tiebreak: FAAB_TIEBREAK_TO_DB[state.faabTiebreak],
        playoff_seeding_format: (SEEDING_TO_DB[state.playoffSeedingFormat] ?? SEEDING_TO_DB.Standard).format,
        reseed_each_round: (SEEDING_TO_DB[state.playoffSeedingFormat] ?? SEEDING_TO_DB.Standard).reseed,
        scoring_type: SCORING_TYPE_TO_DB[state.scoringType] ?? 'points',
        buy_in_amount: state.buyIn || null,
        venmo_username: sanitizeHandle(state.venmoUsername) || null,
        cashapp_tag: sanitizeHandle(state.cashappTag) || null,
        paypal_username: sanitizeHandle(state.paypalUsername) || null,
        // Taxi is dynasty-only — guard the payload even if a stale count lingers
        // in state from toggling league type.
        taxi_slots: isDynasty ? taxiSlotCount : 0,
        taxi_max_experience: isDynasty && taxiSlotCount > 0 ? state.taxiMaxExperience : null,
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
        trade_deadline: state.tradeDeadlineDate,
      })
      .select()
      .single();

    if (leagueError) {
      logger.error('Create league insert failed', leagueError);
      // Per-user cap trigger, the NFL admin gate (P0001 RAISE), and other
      // constraint violations surface human-readable messages — show them
      // rather than swallowing into a generic alert.
      const code = (leagueError as any).code;
      const friendly = code === '23514' || code === 'P0001' || /maximum of \d+ leagues/i.test(leagueError.message)
        ? leagueError.message
        : 'Failed to create league.';
      Alert.alert(friendly);
      setLoading(false);
      return;
    }

    // 2. Attach everything the league needs to FUNCTION — roster config, scoring
    // settings, the initial draft, and its picks — in ONE transaction.
    //
    // These used to be four more sequential inserts, and the error handling for
    // the middle ones was an alert saying "League created but failed to save
    // roster config" followed by carrying on. A league with no roster config
    // can't resolve a lineup slot; with no scoring settings nothing can be
    // scored. The user landed in a league that looked real and silently wasn't.
    //
    // The leagues INSERT above stays here (its ~50 columns are fed by the
    // wizard's enum maps, and rebuilding that column list in SQL would mean a
    // new setting could silently stop being saved). If the setup fails, the bare
    // league row is deleted — safe, since nothing points at it yet.
    const rosterRows = state.rosterSlots
      .filter((s) => s.count > 0)
      .map((s) => ({ position: s.position, slot_count: s.count }));

    const scoringRows = state.scoringType === 'Points'
      ? state.scoring.map((s) => ({
          stat_name: s.stat_name,
          point_value: s.point_value,
          is_enabled: true,
          inverse: false,
        }))
      : state.categories
          .filter((c) => c.is_enabled)
          .map((c) => ({
            stat_name: c.stat_name,
            point_value: 0,
            is_enabled: true,
            inverse: c.inverse,
          }));

    // Round acceleration only persists when both halves are set and the
    // threshold falls inside the draft. Slow (async) drafts never accelerate —
    // the wizard hides those controls, but stale state from before a pace switch
    // could still be set.
    const accelerates =
      state.accelerateAfterRound != null &&
      state.accelerateAfterRound < rosterSize &&
      !isSlowClock(state.timePerPick);

    const draftType = state.draftType.toLowerCase() as 'snake' | 'linear';

    const { data: draftId, error: setupError } = await supabase.rpc('setup_league', {
      p_league_id: leagueData.id,
      p_roster_config: rosterRows as unknown as Json,
      p_scoring: scoringRows as unknown as Json,
      p_draft: {
        season: state.season,
        rounds: rosterSize,
        picks_per_round: state.teams,
        time_limit: state.timePerPick,
        accelerate_after_round: accelerates ? state.accelerateAfterRound : null,
        accelerated_time_limit: accelerates ? (state.acceleratedTimePerPick ?? 30) : null,
        draft_type: draftType,
      } as unknown as Json,
      p_initial_picks: buildDraftPicks(
        state.teams,
        rosterSize,
        state.season,
        draftType,
      ) as unknown as Json,
      ...(isDynasty
        ? {
            p_future_picks: buildFutureDraftPicks(
              state.teams,
              state.rookieDraftRounds,
              state.season,
              state.maxDraftYears,
              state.sport,
            ) as unknown as Json,
          }
        : {}),
    });

    if (setupError) {
      logger.error('League setup failed — rolling back the league row', setupError);
      await supabase.from('leagues').delete().eq('id', leagueData.id);
      Alert.alert('Failed to create league.');
      setLoading(false);
      return;
    }
    void draftId;

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

  // Step content is identical on phone + desktop — only the chrome around it
  // differs (mobile: horizontal dots + scroll; desktop: WizardShell rail). Define
  // it once so the two branches can't drift.
  const stepNode = (
    <>
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
          onScoringPreset={(key) => dispatch({ type: "SET_SCORING_PRESET", key })}
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
          onEdit={(section) =>
            setStep(
              { basics: 0, roster: 1, scoring: 2, waivers: 3, season: 4, trade: 5, draft: 6 }[section],
            )
          }
        />
      )}
    </>
  );

  const navNode =
    step < TOTAL_STEPS - 1 ? (
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
    ) : null;

  // Desktop web: persistent vertical step rail + framed content column. Reuses
  // the same step components; only the chrome differs.
  if (isDesktop) {
    return (
      <SportThemeProvider sport={state.sport}>
        <WizardShell
          title="Create League"
          subtitle="Configure your league, step by step."
          steps={STEP_LABELS}
          currentStep={step}
          onCancel={handleCancel}
          onStepPress={(i) => {
            if (i < step) setStep(i);
          }}
          aside={<WizardSummary state={state} />}
          footer={navNode}
        >
          {stepNode}
        </WizardShell>
      </SportThemeProvider>
    );
  }

  return (
    // Override the active-league sport so the wizard's primary chrome
    // (Next/Create buttons via BrandButton, StepScoring category chips)
    // follows the *picked* sport rather than whatever league the user
    // came from. NBA → turfGreen, WNBA → merlot.
    <SportThemeProvider sport={state.sport}>
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
        {stepNode}
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

      {navNode}
    </ThemedView>
    </SportThemeProvider>
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
