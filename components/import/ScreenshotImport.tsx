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
import { StepDraft } from '@/components/create-league/StepDraft';
import { StepSeason } from '@/components/create-league/StepSeason';
import { StepTrade } from '@/components/create-league/StepTrade';
import { StepWaivers } from '@/components/create-league/StepWaivers';
import {
  computeImportSeasons,
  resolveDraftOrder,
  validateLotteryOrder,
} from '@/components/import/draftPhase';
import { DraftPhaseSelector } from '@/components/import/DraftPhaseSelector';
import { buildRosterPlayers } from '@/components/import/screenshot/buildRosterPlayers';
import {
  deserializeState,
  initialState,
  reducer,
  serializeState,
  STEP_LABELS,
  STORAGE_KEY,
  type HistorySeasonData,
  type PersistedState,
} from '@/components/import/screenshot/state';
import { StepHistory } from '@/components/import/screenshot/StepHistory';
import { StepReview } from '@/components/import/screenshot/StepReview';
import { StepRosters } from '@/components/import/screenshot/StepRosters';
import { StepSettings } from '@/components/import/screenshot/StepSettings';
import { StepTeams } from '@/components/import/screenshot/StepTeams';
import { TradedPicksEditor } from '@/components/import/TradedPicksEditor';
import { TradedPicksScanner } from '@/components/import/TradedPicksScanner';
import { BrandButton } from '@/components/ui/BrandButton';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { ThemedView } from '@/components/ui/ThemedView';
import { WizardShell } from '@/components/web/WizardShell';
import { WizardSummary } from '@/components/web/WizardSummary';
import { Colors } from '@/constants/Colors';
import {
  LEAGUE_TYPE_TO_DB,
  parseSeasonStartYear,
  FAAB_TIEBREAK_TO_DB,
  SEEDING_TO_DB,
  WAIVER_PRIORITY_RESET_TO_DB,
  type LeagueWizardState,
} from '@/constants/LeagueDefaults';
import { useToast } from '@/context/ToastProvider';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { SportThemeProvider } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  useExtractHistory,
  useExtractRoster,
  useExtractSettings,
  useScreenshotImport,
} from '@/hooks/useImportScreenshot';
import { assignHistoryDivisions } from '@/utils/league/historyDivisions';
import { applyDefaultTeamMatches } from '@/utils/league/historyTeamMatch';
import { ms, s } from '@/utils/scale';


// Reverse-standings order (team names) from the most recent extracted/typed
// season — the round-2 default for lottery leagues (a lottery only sets round
// 1). Mirrors the edge's reverse-standings sort (wins asc, then points-for asc).
function reverseStandingsNamesFromHistory(seasons: HistorySeasonData[]): string[] {
  const extracted = seasons
    .map((h) => h.extracted)
    .filter((e): e is NonNullable<typeof e> => !!e?.teams?.length);
  if (!extracted.length) return [];
  const latest = [...extracted].sort((a, b) => ((a.season ?? '') < (b.season ?? '') ? 1 : -1))[0];
  return [...latest.teams]
    .sort((a, b) => (a.wins ?? 0) - (b.wins ?? 0) || (a.points_for ?? 0) - (b.points_for ?? 0))
    .map((t) => t.team_name);
}

// The desktop rail treats picking an import source as the first step — matching
// the Sleeper flow — so the rail index runs one ahead of `step`.
const RAIL_LABELS = ['Source', ...STEP_LABELS];

// --- Component ---

/** `onBackToSource` returns to import-league's source chooser (desktop rail step 0). */
export function ScreenshotImport({ onBackToSource }: { onBackToSource?: () => void }) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { isDesktop } = useBreakpoint();
  const { showToast } = useToast();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [step, setStep] = useState(0);
  // True when the user chose "Finish Rosters Later" — carried into Review so
  // its submit creates the league with empty shells for unfinished teams.
  const [finishLater, setFinishLater] = useState(false);
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
        const teamNames = state.teams.map((t) => t.team_name);
        const reconciled = { ...result, teams: applyDefaultTeamMatches(result.teams, teamNames) };
        dispatch({ type: 'SET_HISTORY_EXTRACTED', seasonIndex, data: reconciled });
      } catch (err: any) {
        Alert.alert('Extraction failed', err.message ?? 'Could not extract history from screenshot.');
      }
    },
    [state.historySeasons, state.teams, extractHistoryMutation],
  );

  // --- Import execution ---

  const handleImport = useCallback(async (finishLater = false) => {
    const ws = state.wizardState;

    // Full import sends only teams with rosters. "Finish later" sends every
    // team — finished ones populated, the rest as empty shells — so the league
    // is created with all N teams and the remaining rosters can be imported
    // later. The execute endpoint accepts empty `players` arrays.
    const sourceTeams = finishLater
      ? state.teams
      : state.teams.filter((team) => team.extracted && team.matched.length + team.resolvedMappings.size > 0);

    const teamsPayload = sourceTeams.map((team) => {
      const players = team.extracted
        ? buildRosterPlayers(team.matched, team.unmatched, team.resolvedMappings)
        : [];
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
      history = extractedSeasons.map((s) => {
        const divisions = assignHistoryDivisions(s.extracted!.teams);
        return {
          season: s.extracted!.season ?? 'unknown',
          teams: s.extracted!.teams.map((t, i) => ({
            team_name: t.team_name,
            source_name: t.source_name ?? t.team_name,
            wins: t.wins ?? 0,
            losses: t.losses ?? 0,
            ties: t.ties ?? 0,
            points_for: t.points_for ?? 0,
            points_against: t.points_against ?? 0,
            standing: t.standing ?? i + 1,
            division: divisions[i],
            playoff_result: t.playoff_result ?? null,
          })),
          bracket: s.extracted!.bracket ?? null,
        };
      });
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
      draft_phase: state.draftPhase,
      lottery_order:
        state.draftPhase === 'lottery_done'
          ? (validateLotteryOrder(state.lotteryOrder, state.teams.length)
              ? state.lotteryOrder
              : state.teams.map((t) => t.team_name))
          : [],
      // Round-2 order (only for lottery_done): explicit override → reverse
      // standings → round 1 — the same fallback the selector previews.
      lottery_order_round2:
        state.draftPhase === 'lottery_done' && state.wizardState.rookieDraftRounds >= 2
          ? resolveDraftOrder(
              [
                state.lotteryOrderR2,
                reverseStandingsNamesFromHistory(state.historySeasons),
                state.lotteryOrder,
              ],
              state.teams.map((t) => t.team_name),
            )
          : undefined,
      traded_future_picks: state.tradedPicks.map((p) => ({
        season: p.season,
        round: p.round,
        original_team_name: p.fromKey,
        new_owner_team_name: p.toKey,
      })),
      settings: {
        season: ws.season,
        sport: ws.sport,
        regular_season_weeks: ws.regularSeasonWeeks,
        playoff_weeks: ws.playoffWeeks,
        playoff_teams: ws.playoffTeams,
        combine_cup_week: ws.sport === 'nba' ? (ws.combineCupWeek ?? false) : false,
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
        waiver_priority_reset: WAIVER_PRIORITY_RESET_TO_DB[ws.waiverPriorityReset],
        faab_tiebreak: FAAB_TIEBREAK_TO_DB[ws.faabTiebreak],
        playoff_seeding_format: (SEEDING_TO_DB[ws.playoffSeedingFormat] ?? SEEDING_TO_DB.Standard).format,
        reseed_each_round: (SEEDING_TO_DB[ws.playoffSeedingFormat] ?? SEEDING_TO_DB.Standard).reseed,
        buy_in_amount: ws.buyIn || null,
        trade_deadline: ws.tradeDeadlineDate,
      },
    };

    try {
      const result = await importMutation.mutateAsync(payload);
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});

      const goToClaim = () =>
        router.replace({
          pathname: '/claim-team',
          params: { leagueId: result.league_id, isCommissioner: 'true' },
        });

      // Surface history reconciliation so a name-match failure can't silently
      // swallow the standings the user took the time to enter.
      const sentHistory = !!history?.length;
      const inserted = result.history_inserted ?? 0;
      const unmatched = result.history_unmatched ?? [];
      const duplicates = result.duplicate_players ?? [];

      const finishHistoryAndClaim = () => {
        if (sentHistory && inserted === 0) {
          const names = unmatched.slice(0, 6).join(', ');
          Alert.alert(
            "League created — but past seasons weren't saved",
            `None of the imported standings matched your team names${
              names ? ` (unmatched: ${names}${unmatched.length > 6 ? '…' : ''})` : ''
            }. Rename your teams to match the standings, then add history from League Info → "Add Season History."`,
            [{ text: 'OK', onPress: goToClaim }],
          );
          return;
        }
        if (sentHistory && unmatched.length > 0) {
          showToast('info', `Saved — but ${unmatched.length} team${unmatched.length === 1 ? '' : 's'} didn't match and were skipped.`);
        } else if (duplicates.length === 0) {
          showToast('success', result.message);
        }
        goToClaim();
      };

      // A player listed on two teams is kept on only one — name the skipped
      // players so the commissioner can add them to the correct team's roster.
      if (duplicates.length > 0) {
        const names = duplicates.slice(0, 8).map((p) => p.name).join(', ');
        Alert.alert(
          'League created — duplicate players skipped',
          `${duplicates.length} player${duplicates.length === 1 ? ' was' : 's were'} listed on more than one team and kept on only one: ${names}${
            duplicates.length > 8 ? '…' : ''
          }. Add ${duplicates.length === 1 ? 'it' : 'them'} to the correct team from that team's roster.`,
          [{ text: 'OK', onPress: finishHistoryAndClaim }],
        );
        return;
      }
      finishHistoryAndClaim();
    } catch (err: any) {
      Alert.alert('Import failed', err.message ?? 'Unknown error');
    }
  }, [state, importMutation, router, showToast]);

  // Number of teams with a usable roster so far — drives the "finish later"
  // copy and the confirm prompt.
  const finishedTeamCount = state.teams.filter(
    (t) => t.extracted && t.matched.length + t.resolvedMappings.size > 0,
  ).length;

  // "Finish Rosters Later" doesn't create the league directly — it advances to
  // Review (with the finish-later intent) so settings still get a final check
  // before creation, same as the full path. Review's submit handles the create.
  const handleFinishLater = useCallback(() => {
    setFinishLater(true);
    setStep(STEP_LABELS.length - 1);
    scrollToTop();
  }, [scrollToTop]);

  // --- Per-step advance gates ---
  //  0 (Basics): league name required.
  //  7 (History): if any seasons were requested, every season's
  //     screenshot must be extracted. 0 seasons skips the gate
  //     entirely (the Next button switches to "Skip").
  //  8 (Rosters): every team must be extracted AND have no unresolved
  //     unmatched players left, to reach Review. The "Finish Rosters
  //     Later" button bypasses this gate by creating the league directly.
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
    if (step === 7) return allHistoryExtracted;
    if (step === 8) return allTeamsResolved;
    return true;
  })();

  const nextLabel = step === 7 && state.historySeasons.length === 0 ? 'Skip' : 'Next';

  // Step 6 (draft) inputs shared by DraftPhaseSelector, the traded-picks
  // scanner, and the traded-picks editor. Screenshot imports reference teams
  // by name (no roster ids exist yet).
  const draftTeamRefs = state.teams.map((t) => ({ key: t.team_name, name: t.team_name }));
  const tradedPickSeasons = computeImportSeasons(
    state.wizardState.season,
    state.wizardState.sport,
    state.wizardState.maxDraftYears,
    state.draftPhase !== 'in_season',
  );

  // Nav (Back/Next). The Review step owns its own Back + Import via StepReview.
  // Defined once so mobile and desktop share it.
  const navNode =
    step < STEP_LABELS.length - 1 ? (
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
            setFinishLater(false);
            setStep((s) => s + 1);
            scrollToTop();
          }}
          variant="primary"
          size="default"
          disabled={!canAdvance}
          accessibilityLabel={`${nextLabel}, step ${step + 2} of ${STEP_LABELS.length}`}
        />
      </View>
    ) : null;

  // Step content is identical on phone + desktop — only the surrounding chrome
  // differs. Defined once so the two branches can't drift.
  const stepNode = (
    <>
            {step === 0 && (
              <StepBasics
                state={state.wizardState}
                onChange={handleBasicsChange}
                ignoreCreationWindow
              />
            )}

            {step === 1 && <StepTeams teams={state.teams} dispatch={dispatch} />}

            {step === 2 && (
              <StepSettings
                state={state}
                dispatch={dispatch}
                onChange={handleWizardChange}
                onExtractSettings={handleExtractSettings}
                extractSettingsMutation={extractSettingsMutation as any}
              />
            )}

            {step === 3 && (
              <StepWaivers state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === 4 && (
              <StepSeason state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === 5 && (
              <StepTrade state={state.wizardState} onChange={handleWizardChange} />
            )}

            {step === 6 && (
              <>
                <StepDraft state={state.wizardState} onChange={handleWizardChange} hideStartupDraft />
                <DraftPhaseSelector
                  isDynasty={state.wizardState.leagueType === 'Dynasty'}
                  usesLottery={state.wizardState.rookieDraftOrder === 'Lottery'}
                  phase={state.draftPhase}
                  onPhaseChange={(v) => dispatch({ type: 'SET_DRAFT_PHASE', value: v })}
                  teams={draftTeamRefs}
                  rounds={state.wizardState.rookieDraftRounds}
                  lotteryOrder={state.lotteryOrder}
                  onLotteryOrderChange={(v) => dispatch({ type: 'SET_LOTTERY_ORDER', value: v })}
                  round2Order={state.lotteryOrderR2}
                  onRound2OrderChange={(v) => dispatch({ type: 'SET_LOTTERY_ORDER_R2', value: v })}
                  defaultRound2Order={reverseStandingsNamesFromHistory(state.historySeasons)}
                />
                {state.wizardState.leagueType === 'Dynasty' && (
                  <TradedPicksEditor
                    teams={draftTeamRefs}
                    seasons={tradedPickSeasons}
                    rounds={state.wizardState.rookieDraftRounds}
                    value={state.tradedPicks}
                    onChange={(v) => dispatch({ type: 'SET_TRADED_PICKS', value: v })}
                  >
                    <TradedPicksScanner
                      teams={draftTeamRefs}
                      seasons={tradedPickSeasons}
                      rounds={state.wizardState.rookieDraftRounds}
                      sport={state.wizardState.sport}
                      defaultDraftYear={parseSeasonStartYear(state.wizardState.season)}
                      value={state.tradedPicks}
                      onChange={(v) => dispatch({ type: 'SET_TRADED_PICKS', value: v })}
                    />
                  </TradedPicksEditor>
                )}
              </>
            )}

            {step === 7 && (
              <StepHistory
                historySeasons={state.historySeasons}
                currentHistoryIndex={state.currentHistoryIndex}
                onSetSeasonCount={(count) => dispatch({ type: 'SET_HISTORY_SEASON_COUNT', count })}
                onSetImages={(seasonIndex, images) => dispatch({ type: 'SET_HISTORY_IMAGES', seasonIndex, images })}
                onSetExtracted={(seasonIndex, data) => dispatch({ type: 'SET_HISTORY_EXTRACTED', seasonIndex, data })}
                onSelectSeason={(index) => dispatch({ type: 'SET_CURRENT_HISTORY', index })}
                onExtractHistory={handleExtractHistory}
                extractHistoryMutation={extractHistoryMutation as any}
                scrollToTop={scrollToTop}
                teamNames={state.teams.map((t) => t.team_name)}
                season={state.wizardState.season}
                sport={state.wizardState.sport}
              />
            )}

            {step === 8 && (
              <>
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
                <View style={styles.finishLaterWrap}>
                  <BrandButton
                    label="Finish Rosters Later"
                    variant="secondary"
                    size="default"
                    fullWidth
                    onPress={handleFinishLater}
                    accessibilityLabel="Review your settings and create the league now, importing the remaining rosters later"
                  />
                  <Text style={[styles.finishLaterHint, { color: c.secondaryText }]}>
                    {finishedTeamCount > 0
                      ? `Continue with the ${finishedTeamCount} team${finishedTeamCount === 1 ? '' : 's'} you've finished — review your settings next, then import the rest anytime.`
                      : 'Continue to review your settings, then create your league and import every roster later.'}
                  </Text>
                </View>
              </>
            )}

            {step === 9 && (
              <StepReview
                state={state}
                finishLater={finishLater}
                onSubmit={() => handleImport(finishLater)}
                onBack={() => setStep((s) => s - 1)}
                loading={importMutation.isPending}
                onEdit={(section) =>
                  setStep(
                    { basics: 0, roster: 2, scoring: 2, waivers: 3, season: 4, trade: 5, draft: 6 }[section],
                  )
                }
              />
            )}
    </>
  );

  // Desktop web: vertical step rail + framed content column + live summary,
  // reusing the same step components. Rail step 0 is the source choice.
  if (isDesktop) {
    return (
      <SportThemeProvider sport={state.wizardState.sport}>
        <WizardShell
          title="Import League"
          subtitle="Pull your league in from screenshots, step by step."
          steps={RAIL_LABELS}
          currentStep={step + 1}
          onCancel={handleCancel}
          onStepPress={(i) => {
            // Rail index 0 is the source choice; the rest are offset by one.
            if (i === 0) onBackToSource?.();
            else if (i - 1 < step) {
              setStep(i - 1);
              scrollToTop();
            }
          }}
          aside={<WizardSummary state={state.wizardState} />}
          footer={navNode}
        >
          {stepNode}
        </WizardShell>
      </SportThemeProvider>
    );
  }

  return (
    // Override the active-league sport so the wizard's chrome (Next/Import
    // buttons via BrandButton, StepIndicator dots) follows the *picked* sport
    // rather than whatever league the user came from — mirrors create-league.
    <SportThemeProvider sport={state.wizardState.sport}>
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
            {stepNode}
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
  finishLaterWrap: {
    marginTop: s(20),
    gap: s(6),
  },
  finishLaterHint: {
    fontSize: ms(11),
    lineHeight: ms(15),
    textAlign: 'center',
  },
});
