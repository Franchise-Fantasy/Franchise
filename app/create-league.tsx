import { StepBasics } from "@/components/create-league/StepBasics";
import { StepDraft } from "@/components/create-league/StepDraft";
import { StepReview } from "@/components/create-league/StepReview";
import { StepRoster } from "@/components/create-league/StepRoster";
import { StepScoring } from "@/components/create-league/StepScoring";
import { StepSeason, computeMaxWeeks } from "@/components/create-league/StepSeason";
import { StepTrade } from "@/components/create-league/StepTrade";
import { StepWaivers } from "@/components/create-league/StepWaivers";
import { ThemedView } from "@/components/ThemedView";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { Colors } from "@/constants/Colors";
import {
  CURRENT_NBA_SEASON,
  DEFAULT_CATEGORIES,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  CategoryConfig,
  LEAGUE_TYPE_TO_DB,
  LeagueWizardState,
  SCORING_TYPE_TO_DB,
  ScoringTypeOption,
  SEEDING_TO_DB,
  STEP_LABELS,
} from "@/constants/LeagueDefaults";
import { calcLotteryPoolSize, defaultPlayoffTeams, getPlayoffTeamOptions } from "@/utils/lottery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { generateDraftPicks, generateFutureDraftPicks } from "@/lib/draft";
import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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
  regularSeasonWeeks: maxWeeks - DEFAULT_PLAYOFF_WEEKS,
  playoffWeeks: DEFAULT_PLAYOFF_WEEKS,
  playoffTeams: defaultPlayoffTeams(DEFAULT_PLAYOFF_WEEKS, 10),
  playoffSeedingFormat: "Standard",
  reseedEachRound: false,
  pickConditionsEnabled: false,
  draftPickTradingEnabled: false,
  tradeDeadlineWeek: 0,
  buyIn: 0,
  taxiMaxExperience: null,
  weeklyAcquisitionLimit: null,
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
      // When switching away from dynasty, disable pick-related features
      if (action.field === 'leagueType' && action.value !== 'Dynasty') {
        return { ...next, draftPickTradingEnabled: false, pickConditionsEnabled: false, maxDraftYears: 0 };
      }
      if (action.field === 'leagueType' && action.value === 'Dynasty') {
        return { ...next, maxDraftYears: 3 };
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

  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const hasRestoredRef = useRef(false);

  // Restore saved wizard progress on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(WIZARD_STORAGE_KEY);
        if (!saved || hasRestoredRef.current) return;
        const { state: savedState, step: savedStep } = JSON.parse(saved);
        if (!savedState?.name) return; // nothing meaningful saved
        Alert.alert(
          'Resume Progress?',
          `You have a saved league "${savedState.name}" (step ${savedStep + 1}/${STEP_LABELS.length}). Continue where you left off?`,
          [
            { text: 'Start Over', style: 'destructive', onPress: () => AsyncStorage.removeItem(WIZARD_STORAGE_KEY) },
            {
              text: 'Resume',
              onPress: () => {
                // Replay saved state into the reducer
                for (const [key, value] of Object.entries(savedState)) {
                  dispatch({ type: 'SET_FIELD', field: key as keyof LeagueWizardState, value });
                }
                setStep(savedStep);
              },
            },
          ],
        );
        hasRestoredRef.current = true;
      } catch {}
    })();
  }, []);

  // Persist wizard state on every change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistWizard = useCallback((s: LeagueWizardState, currentStep: number) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({ state: s, step: currentStep })).catch(() => {});
    }, 500);
  }, []);

  useEffect(() => {
    persistWizard(state, step);
  }, [state, step, persistWizard]);

  // Steps: 0=Basics, 1=Roster, 2=Scoring, 3=Trade, 4=Waivers, 5=Season, 6=Draft, 7=Review
  const TOTAL_STEPS = STEP_LABELS.length;
  const isOddTeamByeInvalid =
    step === 5 &&
    state.teams % 2 !== 0 &&
    state.regularSeasonWeeks % state.teams !== 0;
  const canAdvance =
    step === 0 ? state.name.trim().length > 0 : !isOddTeamByeInvalid;

  const handleChange = (field: keyof LeagueWizardState, value: any) => {
    dispatch({ type: "SET_FIELD", field, value });
  };

  const handleCreateLeague = async () => {
    setLoading(true);

    const user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      Alert.alert("User not logged in.");
      setLoading(false);
      return;
    }

    const rosterSize = state.rosterSlots.reduce((sum, s) => (s.position === 'IR' || s.position === 'TAXI') ? sum : sum + s.count, 0);
    const taxiSlotCount = state.rosterSlots.find((s) => s.position === 'TAXI')?.count ?? 0;

    // Compute season start (mirrors computeSeasonStart in StepSeason.tsx)
    // Mon/Tue/Wed: start today. Thu–Sun: start next Monday.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay(); // 0=Sun
    const daysSinceMon = dow === 0 ? 6 : dow - 1;
    const daysLeft = 7 - daysSinceMon;
    let seasonStart = today;
    if (daysLeft < 5) {
      seasonStart = new Date(today);
      seasonStart.setDate(today.getDate() + (7 - daysSinceMon));
    }
    const seasonStartDate = `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, "0")}-${String(seasonStart.getDate()).padStart(2, "0")}`;

    const isDynasty = state.leagueType === 'Dynasty';

    // 1. Create league
    const { data: leagueData, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        name: state.name,
        created_by: user.id,
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
        taxi_slots: taxiSlotCount,
        taxi_max_experience: taxiSlotCount > 0 ? state.taxiMaxExperience : null,
        weekly_acquisition_limit: state.weeklyAcquisitionLimit,
        pick_conditions_enabled: isDynasty ? state.pickConditionsEnabled : false,
        draft_pick_trading_enabled: isDynasty ? state.draftPickTradingEnabled : false,
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
      console.error(leagueError);
      Alert.alert("Failed to create league.");
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
      console.error(rosterError);
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
      console.error(scoringError);
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
      console.error(draftError);
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
    Promise.all(pickPromises).catch((error) => console.error("Error generating draft picks:", error));

    AsyncStorage.removeItem(WIZARD_STORAGE_KEY).catch(() => {});
    setLoading(false);
    router.replace({
      pathname: "/create-team",
      params: {
        leagueId: leagueData.id,
        isCommissioner: "true",
      },
    });
  };

  return (
    <ThemedView style={styles.container}>
      <StepIndicator currentStep={step} steps={STEP_LABELS} />

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
        {step === 3 && <StepTrade state={state} onChange={handleChange} />}
        {step === 4 && <StepWaivers state={state} onChange={handleChange} />}
        {step === 5 && <StepSeason state={state} onChange={handleChange} />}
        {step === 6 && <StepDraft state={state} onChange={handleChange} />}
        {step === 7 && (
          <StepReview
            state={state}
            onSubmit={handleCreateLeague}
            loading={loading}
          />
        )}
      </ScrollView>

      {step < TOTAL_STEPS - 1 && (
        <View style={styles.navRow}>
          {step > 0 ? (
            <TouchableOpacity
              onPress={() => setStep((s) => s - 1)}
              style={[styles.navBtn, { borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Text style={[styles.navBtnText, { color: c.text }]}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          <TouchableOpacity
            onPress={() => setStep((s) => s + 1)}
            disabled={!canAdvance}
            style={[
              styles.navBtn,
              { backgroundColor: canAdvance ? c.accent : c.buttonDisabled },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Next, step ${step + 2} of ${TOTAL_STEPS}`}
            accessibilityState={{ disabled: !canAdvance }}
          >
            <Text style={[styles.navBtnText, { color: c.accentText }]}>
              Next
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: 24,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingBottom: 32,
  },
  navBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});

export const options = {
  headerShown: false,
};
