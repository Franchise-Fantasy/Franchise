import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
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
import {
  deserializeState,
  initialState,
  reducer,
  serializeState,
  STEP_LABELS,
  STORAGE_KEY,
  type PersistedState,
} from '@/components/import/screenshot/state';
import { StepConfig } from '@/components/import/screenshot/StepConfig';
import { StepHistory } from '@/components/import/screenshot/StepHistory';
import { StepReview } from '@/components/import/screenshot/StepReview';
import { StepRosters } from '@/components/import/screenshot/StepRosters';
import { StepSettings } from '@/components/import/screenshot/StepSettings';
import { BrandButton } from '@/components/ui/BrandButton';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { ThemedView } from '@/components/ui/ThemedView';
import { Colors } from '@/constants/Colors';
import {
  LEAGUE_TYPE_TO_DB,
  SEEDING_TO_DB,
  type LeagueWizardState,
} from '@/constants/LeagueDefaults';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  useExtractHistory,
  useExtractRoster,
  useExtractSettings,
  useScreenshotImport,
} from '@/hooks/useImportScreenshot';
import { ms, s } from '@/utils/scale';


// --- Component ---

export function ScreenshotImport() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  // hasRestoredRef gates the auto-save effect — we don't want to
  // overwrite the saved state with `initialState` before the user
  // makes a Resume / Start Over choice.
  const hasRestoredRef = useRef(false);

  const extractRosterMutation = useExtractRoster();
  const extractSettingsMutation = useExtractSettings();
  const extractHistoryMutation = useExtractHistory();
  const importMutation = useScreenshotImport();

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // Scroll hint + chrome mirrors import-league / create-league.
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

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Exit Import?',
      'Your progress is saved — you can come back and pick up where you left off.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => router.back() },
      ],
    );
  }, [router]);

  // ─── Persistence ─────────────────────────────────────────────
  //
  // Same pattern as create-league: try to restore on mount; if there
  // are signs of meaningful progress (a league name or any extracted
  // teams), prompt to resume vs start over. After the choice, mark
  // hasRestoredRef so the auto-save effect can begin writing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || cancelled) {
          hasRestoredRef.current = true;
          return;
        }
        const parsed = JSON.parse(raw) as PersistedState;
        const hasProgress =
          !!parsed.wizardState?.name?.trim() ||
          (parsed.teams ?? []).some((t) => t.extracted);
        if (!hasProgress) {
          await AsyncStorage.removeItem(STORAGE_KEY);
          hasRestoredRef.current = true;
          return;
        }

        Alert.alert(
          'Resume Import?',
          `You have a saved screenshot import for "${parsed.wizardState.name || 'Unnamed league'}". Pick up where you left off?`,
          [
            {
              text: 'Start Over',
              style: 'destructive',
              onPress: () => {
                AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
                hasRestoredRef.current = true;
              },
            },
            {
              text: 'Resume',
              onPress: () => {
                const restored = deserializeState(parsed);
                dispatch({ type: 'HYDRATE', state: restored });
                setStep(parsed.step ?? 0);
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
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const payload = serializeState(state, step);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
    }, 500);
  }, [state, step]);

  // --- Wizard field change ---

  const handleWizardChange = useCallback((field: keyof LeagueWizardState, value: any) => {
    dispatch({ type: 'SET_WIZARD_FIELD', field, value });
  }, []);

  const handleTeamCountChange = useCallback((count: number) => {
    dispatch({ type: 'SET_TEAM_COUNT', count });
  }, []);

  // Reusing create-league's StepBasics — but the team count there is
  // a regular SET_WIZARD_FIELD on `state.teams`, while in the
  // screenshot flow setting the count also rebuilds the per-team
  // rosters array. Intercept the `teams` field and route it through
  // SET_TEAM_COUNT instead.
  const handleBasicsChange = useCallback(
    (field: keyof LeagueWizardState, value: any) => {
      if (field === 'teams') {
        handleTeamCountChange(value as number);
      } else {
        handleWizardChange(field, value);
      }
    },
    [handleWizardChange, handleTeamCountChange],
  );

  // --- Roster extraction ---

  const handleExtractRoster = useCallback(async () => {
    const team = state.teams[state.currentTeamIndex];
    if (!team.images.length) {
      Alert.alert('Add a screenshot', "Take or select a screenshot of this team's roster.");
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

  const handleResolvePlayer = useCallback(
    (index: number, playerId: string, name: string, position: string) => {
      dispatch({
        type: 'RESOLVE_PLAYER',
        teamIndex: state.currentTeamIndex,
        playerIndex: index,
        playerId,
        name,
        position,
      });
    },
    [state.currentTeamIndex],
  );

  const handleSkipPlayer = useCallback(
    (index: number) => {
      dispatch({
        type: 'SKIP_PLAYER',
        teamIndex: state.currentTeamIndex,
        playerIndex: index,
      });
    },
    [state.currentTeamIndex],
  );

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

  const handleExtractHistory = useCallback(
    async (seasonIndex: number) => {
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
    },
    [state.historySeasons, extractHistoryMutation],
  );

  // --- Import execution ---

  const handleImport = useCallback(async () => {
    const ws = state.wizardState;

    // Build teams payload — skip teams with no roster data
    const teamsPayload = state.teams
      .filter((team) => team.extracted && (team.matched.length + team.resolvedMappings.size > 0))
      .map((team) => {
        const players: { player_id: string; position: string; roster_slot: string | null }[] = [];

        for (const m of team.matched) {
          players.push({
            player_id: m.matched_player_id,
            position: m.matched_position,
            roster_slot: m.roster_slot,
          });
        }

        for (const [index, resolved] of team.resolvedMappings) {
          const original = team.unmatched.find((u) => u.index === index);
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
      .filter((s) => s.count > 0)
      .map((s) => ({ position: s.position, count: s.count }));

    const scoring = ws.scoring.map((s) => ({
      stat_name: s.stat_name,
      point_value: s.point_value,
    }));

    const categories =
      ws.scoringType === 'H2H Categories'
        ? ws.categories.map((c) => ({
            stat_name: c.stat_name,
            is_enabled: c.is_enabled,
            inverse: c.inverse,
          }))
        : undefined;

    let history: any[] | undefined;
    const extractedSeasons = state.historySeasons.filter((s) => s.extracted?.teams?.length);
    if (extractedSeasons.length > 0) {
      history = extractedSeasons.map((s) => ({
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
        trade_veto_type:
          ws.tradeVetoType === 'Commissioner'
            ? 'commissioner'
            : ws.tradeVetoType === 'League Vote'
              ? 'league_vote'
              : 'none',
        trade_review_period_hours: ws.tradeVetoType === 'None' ? 0 : ws.tradeReviewPeriodHours,
        trade_votes_to_veto: ws.tradeVotesToVeto,
        draft_pick_trading_enabled: ws.draftPickTradingEnabled,
        pick_conditions_enabled: ws.pickConditionsEnabled,
        waiver_type:
          ws.waiverType === 'Standard'
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
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      showToast('success', result.message);
      router.replace({
        pathname: '/claim-team',
        params: { leagueId: result.league_id, isCommissioner: 'true' },
      });
    } catch (err: any) {
      Alert.alert('Import failed', err.message ?? 'Unknown error');
    }
  }, [state, importMutation, router, showToast]);

  // --- Per-step advance gates ---
  //  0 (Basics): league name required.
  //  2 (Rosters): every team must be extracted AND have no
  //     unresolved unmatched players left. Prevents the user from
  //     advancing while half their teams still need a screenshot.
  //  3 (History): if any seasons were requested, every season's
  //     screenshot must be extracted. 0 seasons skips the gate
  //     entirely (the Next button switches to "Skip").
  //  All other steps: open advance.
  const allTeamsResolved = state.teams.every((t) => {
    if (!t.extracted) return false;
    const unresolved = t.unmatched.filter(
      (p) => !t.resolvedMappings.has(p.index) && !t.skippedPlayers.has(p.index),
    ).length;
    return unresolved === 0;
  });
  const allHistoryExtracted =
    state.historySeasons.length === 0 ||
    state.historySeasons.every((s) => !!s.extracted);

  const canAdvance = (() => {
    if (step === 0) return !!state.wizardState.name.trim();
    if (step === 2) return allTeamsResolved;
    if (step === 3) return allHistoryExtracted;
    return true;
  })();

  const nextLabel = step === 3 && state.historySeasons.length === 0 ? 'Skip' : 'Next';

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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            {step === 0 && (
              <StepBasics state={state.wizardState} onChange={handleBasicsChange} />
            )}

            {step === 1 && (
              <StepSettings
                state={state}
                dispatch={dispatch}
                onChange={handleWizardChange}
                onExtractSettings={handleExtractSettings}
                extractSettingsMutation={extractSettingsMutation as any}
              />
            )}

            {step === 2 && (
              <StepRosters
                teams={state.teams}
                currentTeamIndex={state.currentTeamIndex}
                dispatch={dispatch}
                onExtractRoster={handleExtractRoster}
                onResolvePlayer={handleResolvePlayer}
                onSkipPlayer={handleSkipPlayer}
                extractRosterMutation={extractRosterMutation as any}
                scrollToTop={scrollToTop}
              />
            )}

            {step === 3 && (
              <StepHistory
                historySeasons={state.historySeasons}
                currentHistoryIndex={state.currentHistoryIndex}
                dispatch={dispatch}
                onExtractHistory={handleExtractHistory}
                extractHistoryMutation={extractHistoryMutation as any}
                scrollToTop={scrollToTop}
              />
            )}

            {step === 4 && <StepConfig state={state.wizardState} onChange={handleWizardChange} />}

            {step === 5 && (
              <StepReview
                state={state}
                onSubmit={handleImport}
                onBack={() => setStep((s) => s - 1)}
                loading={importMutation.isPending}
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

      {/* Nav — Review step owns its own Back + Import buttons via
          StepReview, so chrome nav only renders on steps 0-4. */}
      {step < STEP_LABELS.length - 1 && (
        <View style={styles.navRow}>
          {step > 0 ? (
            <BrandButton
              label="Back"
              onPress={() => {
                setStep((s) => s - 1);
                scrollToTop();
              }}
              variant="secondary"
              size="default"
            />
          ) : (
            <View />
          )}
          <BrandButton
            label={nextLabel}
            onPress={() => {
              setStep((s) => s + 1);
              scrollToTop();
            }}
            variant="primary"
            size="default"
            disabled={!canAdvance}
            accessibilityLabel={`${nextLabel}, step ${step + 2} of ${STEP_LABELS.length}`}
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
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 32,
  },
});
