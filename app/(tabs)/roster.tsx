import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useWeeks } from "@/components/matchup/matchupData";
import { OnCourtDot } from "@/components/matchup/PlayerCell";
import { WeekSummarySheet } from "@/components/matchup/WeekSummarySheet";
import { FptsBreakdownModal } from "@/components/player/FptsBreakdownModal";
import { MatchupChip } from "@/components/player/MatchupChip";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { AnimatedFpts } from "@/components/roster/AnimatedFpts";
import { IrLockBanner } from "@/components/roster/IrLockBanner";
import { MyPicksSection } from "@/components/roster/MyPicksSection";
import { OverCapBanner } from "@/components/roster/OverCapBanner";
import {
  buildSeasonAverages,
  computeSlotStats,
  dayToStatRecord,
  fetchTeamRosterForDate,
  type DayGameStats,
  type SeasonAverages,
  type SlotStats,
} from "@/components/roster/rosterData";
import { RosterDayPicker } from "@/components/roster/RosterDayPicker";
import { RosterHero } from "@/components/roster/RosterHero";
import {
  rosterStyles as styles,
  slotPillVariant,
} from "@/components/roster/rosterStyles";
import {
  RosterWindowPicker,
  type RosterStatMode,
} from "@/components/roster/RosterWindowPicker";
import { SeasonMetaLine } from "@/components/roster/SeasonMetaLine";
import { SectionEyebrow } from "@/components/roster/SectionEyebrow";
import {
  DestinationSlot,
  QuickAction,
  RosterPlayer,
  SlotEntry,
  SlotPickerModal,
} from "@/components/roster/SlotPickerModal";
import { UpcomingGame } from "@/components/roster/UpcomingGame";
import { useRosterShare } from "@/components/roster/useRosterShare";
import { ErrorState } from "@/components/ui/ErrorState";
import { InfoModal } from "@/components/ui/InfoModal";
import { type ModalAction } from "@/components/ui/InlineAction";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Colors } from "@/constants/Colors";
import {
  formatSeasonShort,
  getCurrentSeason,
  getPreviousSeason,
} from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useActionPicker } from "@/context/ConfirmProvider";
import { useToast } from "@/context/ToastProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useIllegalIR } from "@/hooks/useIllegalIR";
import { useLeague } from "@/hooks/useLeague";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useOverCap } from "@/hooks/useOverCap";
import {
  usePlayerProjections,
  type ProjectionRow,
} from "@/hooks/usePlayerProjections";
import { usePrevSeasonFpts } from "@/hooks/usePrevSeasonFpts";
import { useRosterChanges } from "@/hooks/useRosterChanges";
import { useRosterGameLogs } from "@/hooks/useRosterGameLogs";
import { useWeekScores } from "@/hooks/useWeekScores";
import { capture } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { addDays, defaultLeagueDay, formatDayLabel, formatShortDate, useSportToday } from "@/utils/dates";
import { formatPosition } from "@/utils/formatting";
import { getSportToday } from "@/utils/leagueTime";
import { logger } from "@/utils/logger";
import { hasAnyGameStarted, isGameStarted, useTodayGameTimes } from "@/utils/nba/gameStarted";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import {
  formatGameInfo,
  liveToGameLog,
  useLivePlayerStats,
} from "@/utils/nba/nbaLive";
import {
  fetchNbaScheduleForDate,
  formatGameTime,
  ScheduleEntry,
} from "@/utils/nba/nbaSchedule";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { isOnline } from "@/utils/network";
import { LineupPlayer, optimizeLineup } from "@/utils/roster/autoLineup";
import { fetchTeamData } from "@/utils/roster/fetchTeamData";
import { guardIllegalIR, isIrEligibleStatus } from "@/utils/roster/illegalIR";
import { guardOverCap } from "@/utils/roster/overCap";
import { isEligibleForSlot, slotLabel } from "@/utils/roster/rosterSlots";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import { canSendToTaxi } from "@/utils/roster/taxiEligibility";
import { buildCompositeScatter } from "@/utils/scoring/categoryAnalytics";
import {
  calculateAvgFantasyPoints,
  formatScore,
  gameWindowSize,
  projAvgRowToFpts,
  windowFantasyPoints,
} from "@/utils/scoring/fantasyPoints";
import { buildWindowedStatRow } from "@/utils/scoring/windowAverages";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RosterScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const sport = useActiveLeagueSport();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  useRosterChanges(leagueId);

  const today = useSportToday(sport);
  const [selectedDate, setSelectedDate] = useState<string>(today);

  // One-shot per league: once the schedule loads, land on the league's first
  // day for a not-yet-started league instead of the pre-tipoff gap day. The
  // init effect that consumes this lives below, after firstWeekStart is derived.
  const didInitDay = useRef(false);

  // If the calendar date rolled over (e.g. app resumed from background after midnight), snap to today
  const prevToday = useRef(today);
  useEffect(() => {
    if (today !== prevToday.current) {
      if (selectedDate === prevToday.current) setSelectedDate(today);
      prevToday.current = today;
    }
  }, [today]);

  // Snap back to today when the active league switches — the day you were
  // viewing in one roster shouldn't carry over to a different league's roster.
  // Re-arm the day init so the new league re-clamps to its own opening night
  // once its schedule loads (firstWeekStart is stale at this point — useWeeks
  // has no keepPreviousData, so it still holds the previous league's value).
  const prevLeague = useRef(leagueId);
  useEffect(() => {
    if (leagueId !== prevLeague.current) {
      prevLeague.current = leagueId;
      didInitDay.current = false;
      setSelectedDate(today);
    }
  }, [leagueId, today]);

  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [activateFromIRPlayer, setActivateFromIRPlayer] = useState(false);
  const [fptsBreakdown, setFptsBreakdown] = useState<{
    stats: Record<string, number | boolean>;
    playerName: string;
    gameLabel: string;
  } | null>(null);
  const [activeSlot, setActiveSlot] = useState<SlotEntry | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  // Window for forward-facing stat display (pre-game / no-game / future rows).
  // Past dates + live/finished games render their real stats and never go
  // through buildSeasonAverages — see the gating at the renderSlotRow call.
  const [windowSel, setWindowSel] = useState<RosterStatMode>('season');
  const pickAction = useActionPicker();


  const isPastDate = selectedDate < today;
  const isFutureDate = selectedDate > today;
  const isToday = selectedDate === today;
  const yesterday = addDays(today, -1);
  const isYesterday = selectedDate === yesterday;

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? "");
  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === "h2h_categories";

  // Next-game projections (points leagues only — categories have no projected
  // fpts). They surface in two places: inline next to each upcoming game, and
  // — when the window picker is switched to "Proj" — in the per-row context
  // slot in place of the season/window average.
  const { data: nextGameProjections } = usePlayerProjections(
    sport,
    "next_game",
    !isCategories,
  );

  const { data: illegalIRPlayers } = useIllegalIR(leagueId, teamId);
  const irLocked = !!illegalIRPlayers && illegalIRPlayers.length > 0;
  const { data: overCap } = useOverCap(leagueId, teamId);
  const overCapLocked = !!overCap?.isOver;
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId ?? "");

  // All weeks, fetched once on a stable key. The VIEWED week is derived
  // synchronously from selectedDate — so navigating day-to-day never blanks
  // `currentWeek` (which would flash the hero into its offseason layout).
  const { data: weeks } = useWeeks(leagueId);
  const currentWeek = useMemo(
    () =>
      weeks?.find(
        (w) => w.start_date <= selectedDate && selectedDate <= w.end_date,
      ) ?? null,
    [weeks, selectedDate],
  );

  // Schedule exists but the selected day is before tip-off (the draft-day gap
  // before opening night). Surfaces an "upcoming" hero that keeps day-nav live
  // so the user can step forward and set their opening-night lineup, instead
  // of the dead-offseason layout that hides every control.
  const firstWeekStart = weeks?.[0]?.start_date ?? null;
  const seasonOpensLabel =
    !currentWeek && firstWeekStart && selectedDate < firstWeekStart
      ? formatShortDate(firstWeekStart)
      : undefined;

  // Land on opening night for a not-yet-started league: clamp the default day
  // to max(today, firstWeekStart) once the schedule loads, so the user opens
  // onto their team rather than the empty pre-tipoff gap day. In-season this is
  // a no-op (defaultLeagueDay returns today). Fires once per league; manual
  // day navigation afterward is preserved (didInitDay latches true).
  useEffect(() => {
    if (didInitDay.current || !weeks) return;
    didInitDay.current = true;
    const target = defaultLeagueDay(today, firstWeekStart);
    if (target !== selectedDate) setSelectedDate(target);
  }, [weeks, today, firstWeekStart, selectedDate]);

  // Date-dropdown picker (jump to any day in the current week)
  const [showDayPicker, setShowDayPicker] = useState(false);
  // Weekly performance-breakdown sheet, opened from the WK chip
  const [showWeekSummary, setShowWeekSummary] = useState(false);

  // First-visit coach mark for tap-to-move interaction
  const [showMoveHint, setShowMoveHint] = useState(false);
  useEffect(() => {
    if (!teamId) return;
    const key = `rosterTapHint:seen:${teamId}`;
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((seen) => {
        if (!cancelled && !seen) setShowMoveHint(true);
      })
      .catch((err) => {
        logger.warn("rosterTapHint read failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);
  const dismissMoveHint = () => {
    setShowMoveHint(false);
    if (teamId) {
      AsyncStorage.setItem(`rosterTapHint:seen:${teamId}`, "1").catch((e) =>
        logger.warn("Persist rosterTapHint failed", e),
      );
    }
  };

  // Screenshot / share
  const { shareRef, isSharing, shareRoster } = useRosterShare();
  // Earliest date this team acquired a player — prevents navigating before the roster existed
  const { data: rosterStartDate } = useQuery({
    queryKey: queryKeys.rosterStartDate(teamId!),
    queryFn: async () => {
      const { data } = await supabase
        .from("league_players")
        .select("acquired_at")
        .eq("team_id", teamId!)
        .order("acquired_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!data?.acquired_at) return null;
      return getSportToday(sport, new Date(data.acquired_at));
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  const canGoBack = !rosterStartDate || selectedDate > rosterStartDate;

  const canAutoLineup =
    !!currentWeek &&
    selectedDate >= today &&
    selectedDate <= currentWeek.end_date;

  // ── Hero matchup data ───────────────────────────────────────────────────
  // Fetches the user's opponent for the current week so the hero can show a
  // matchup score line. Live scores come from `useWeekScores` (cron-updated +
  // realtime).
  const weekIsLive =
    !!currentWeek &&
    today >= currentWeek.start_date &&
    today <= currentWeek.end_date;

  const { data: heroMatchup } = useQuery({
    queryKey: queryKeys.rosterHeroOpponent(
      currentWeek?.id ?? "",
      teamId ?? "",
    ),
    queryFn: async () => {
      if (!teamId) return null;
      // Always fetch team identity (tricode + record) so the hero has
      // something to render in offseason and during weeks with no matchup.
      const fetchTeam = async (id: string) => {
        const { data } = await supabase
          .from("teams")
          .select("id, tricode, name, wins, losses, ties")
          .eq("id", id)
          .maybeSingle();
        return data ?? null;
      };
      if (!currentWeek?.id) {
        const me = await fetchTeam(teamId);
        return { me, opponent: null, isBye: false, categoryRecord: null };
      }
      const { data: m } = await supabase
        .from("league_matchups")
        .select(
          "home_team_id, away_team_id, home_category_wins, away_category_wins, category_ties",
        )
        .eq("schedule_id", currentWeek.id)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .maybeSingle();
      const isHome = m?.home_team_id === teamId;
      const opponentId = m ? (isHome ? m.away_team_id : m.home_team_id) : null;
      const ids = opponentId ? [teamId, opponentId] : [teamId];
      const { data: rows } = await supabase
        .from("teams")
        .select("id, tricode, name, wins, losses, ties")
        .in("id", ids);
      const me = rows?.find((t) => t.id === teamId) ?? null;
      const opp = opponentId
        ? rows?.find((t) => t.id === opponentId) ?? null
        : null;
      // Category leagues are decided by category wins (kept fresh on
      // league_matchups by the same cron that updates week_scores), not the
      // fpts total that lives in week_scores. Build it from the user's
      // perspective; null until the cron has computed a result.
      const categoryRecord =
        m && m.home_category_wins != null
          ? {
              myWins: (isHome ? m.home_category_wins : m.away_category_wins) ?? 0,
              oppWins: (isHome ? m.away_category_wins : m.home_category_wins) ?? 0,
              ties: m.category_ties ?? 0,
            }
          : null;
      return { me, opponent: opp, isBye: !!m && !opponentId, categoryRecord };
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  const { data: weekScores } = useWeekScores({
    leagueId,
    scheduleId: currentWeek?.id ?? null,
    weekIsLive,
  });

  const heroMyScore = teamId ? weekScores?.[teamId] ?? null : null;
  const heroOppScore = heroMatchup?.opponent?.id
    ? weekScores?.[heroMatchup.opponent.id] ?? null
    : null;
  const heroCategoryRecord = isCategories
    ? heroMatchup?.categoryRecord ?? null
    : null;

  // For category leagues the hero shows category wins (from league_matchups)
  // rather than the fpts in week_scores. Those wins are recomputed on every
  // live-stats cron run — the same run that broadcasts the week_scores update
  // that flips `weekScores` here — so refetch the matchup whenever scores tick
  // to keep the live category record in step with the points-league behavior.
  useEffect(() => {
    if (!isCategories || !weekIsLive || !currentWeek?.id || !teamId) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.rosterHeroOpponent(currentWeek.id, teamId),
    });
    // `weekScores` is the live trigger; the rest are stable within a live week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekScores]);

  // Weekly performance breakdown — lazily fetched only while the summary
  // sheet is open. This is WEEK-level, not day-level: anchor the fetch date
  // to `today` for the live week (so player_games stops at yesterday and the
  // live map supplies today — no overlap/double-count) or the week's end for
  // a past week (full week from player_games, no live). Independent of which
  // day the roster is currently showing.
  const summaryFetchDate = weekIsLive ? today : currentWeek?.end_date ?? today;
  const { data: weekSummary, isFetching: weekSummaryFetching } = useQuery({
    queryKey: queryKeys.rosterWeekSummary(
      currentWeek?.id ?? "",
      teamId ?? "",
    ),
    queryFn: () =>
      fetchTeamData(
        teamId!,
        leagueId!,
        currentWeek!,
        summaryFetchDate,
        scoringWeights ?? [],
        sport,
      ),
    enabled:
      showWeekSummary && !!currentWeek && !!teamId && !!leagueId,
    staleTime: 1000 * 60,
  });

  const {
    data: rosterPlayers,
    isLoading: isLoadingRoster,
    isError: isRosterError,
    refetch: refetchRoster,
  } = useQuery<RosterPlayer[]>({
    queryKey: queryKeys.teamRoster(teamId!, selectedDate),
    queryFn: () => fetchTeamRosterForDate(teamId!, leagueId!, selectedDate, sport, currentWeek ?? undefined),
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 30, // 30s — useRosterChanges handles realtime invalidation
    placeholderData: keepPreviousData,
  });

  // For past dates: fetch that day's actual game stats
  const { data: dayGameStats } = useQuery<Map<string, DayGameStats>>({
    queryKey: queryKeys.dayGameStats(teamId!, selectedDate),
    queryFn: async () => {
      const playerIds = rosterPlayers!.map((p) => p.player_id);
      const { data } = await supabase
        .from("player_games")
        .select(
          'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, matchup',
        )
        .in("player_id", playerIds)
        .eq("game_date", selectedDate);
      const map = new Map<string, DayGameStats>();
      for (const row of data ?? []) map.set(row.player_id, row as DayGameStats);
      return map;
    },
    enabled: isPastDate && !!rosterPlayers && rosterPlayers.length > 0,
    staleTime: 1000 * 60 * 60,
  });

  // Schedule for the selected date: tricode → matchup + final score. Fetched
  // for EVERY date (incl. past) so computeSlotStats can tell "team played, my
  // guy was out" (DNP) from "no game that day" on past-date history — an
  // injured player has no player_games row, so the schedule is the only signal
  // the game happened.
  const { data: daySchedule } = useQuery<Map<string, ScheduleEntry>>({
    queryKey: [...queryKeys.daySchedule(selectedDate), sport],
    queryFn: () => fetchNbaScheduleForDate(selectedDate, sport),
    staleTime: 1000 * 60 * 60,
  });

  // Live stats. Kept subscribed across the whole live week (not just
  // today/yesterday) so the weekly-summary live merge has today's data even
  // while browsing a past day of the current week — matches the matchup page.
  const playerIds = rosterPlayers?.map((p) => p.player_id) ?? [];

  // Previous-season fpts/G (points leagues) — powers the "Prev" window option:
  // last season's average in the context slot. Cheap, cached; disabled for
  // categories (no fpts) by passing an empty id list.
  const { data: prevSeasonFpts } = usePrevSeasonFpts(
    leagueId,
    sport,
    isCategories ? [] : playerIds,
    scoringWeights,
  );
  // Compact label for the "Prev" window — the previous season itself ("'25" /
  // "'24-'25") rather than the word "Prev".
  const prevSeasonLabel = formatSeasonShort(getPreviousSeason(sport), sport);

  // Game logs for windowed stat display (Lx → last N played games per player).
  // Only fetched when a non-season window is active so we don't pay the round
  // trip on the default view. The logs apply to forward-facing rows only —
  // past dates and live/finished games render their real stats unchanged.
  // "Proj"/"Prev" aren't game-log windows — they slice nothing, so winSize
  // stays null and the row context reads from projections / last season instead.
  const isProjMode = windowSel === "proj";
  const isPrevMode = windowSel === "prev";
  const winSize =
    windowSel === "proj" || windowSel === "prev" ? null : gameWindowSize(windowSel);
  const { data: rosterLogsByPlayer } = useRosterGameLogs(
    winSize != null ? playerIds : [],
  );
  // Adaptive window options — only show Lx when at least one rostered player
  // has that many games played. Mirrors the rule in PointsStrengthAnalytics.
  const maxRosterGames = useMemo(() => {
    let max = 0;
    for (const p of rosterPlayers ?? []) {
      const g = p.games_played ?? 0;
      if (g > max) max = g;
    }
    return max;
  }, [rosterPlayers]);
  const availableWindows = useMemo<readonly RosterStatMode[]>(() => {
    const out: RosterStatMode[] = [];
    if (maxRosterGames >= 5) out.push('L5');
    if (maxRosterGames >= 10) out.push('L10');
    if (maxRosterGames >= 15) out.push('L15');
    out.push('season');
    // Forward-/historical-looking modes sit below the windows (points leagues):
    // Proj under Season, Prev under Proj.
    if (!isCategories && nextGameProjections && nextGameProjections.size > 0) {
      out.push('proj');
    }
    if (!isCategories && prevSeasonFpts && prevSeasonFpts.size > 0) {
      out.push('prev');
    }
    return out;
  }, [maxRosterGames, isCategories, nextGameProjections, prevSeasonFpts]);
  // Snap stale selection back to 'season' so the SegmentedControl never lands
  // on a hidden option after a season rollover.
  useEffect(() => {
    if (!availableWindows.includes(windowSel)) setWindowSel('season');
  }, [availableWindows, windowSel]);
  const rawLiveMap = useLivePlayerStats(
    playerIds,
    weekIsLive || isToday || isYesterday,
    sport,
  );

  // Filter live stats to only include games matching the selected date.
  // Yesterday's late games (still live past midnight) show on yesterday's view,
  // not today's.
  const liveMap = new Map(
    [...rawLiveMap].filter(([, stats]) => stats.game_date === selectedDate),
  );

  // Hero/summary live-merge map: today's games (live or final — not yet in
  // player_games) plus yesterday's still-live games, EXCLUDING yesterday's
  // finals (already counted in weekPoints via player_games — re-adding them
  // double-counts). Mirrors the matchup hero's heroLiveMap so the weekly
  // summary total matches the scoreboard. See matchup.tsx.
  const heroLiveMap = useMemo(
    () =>
      new Map(
        [...rawLiveMap].filter(
          ([, stats]) => !(stats.game_date < today && stats.game_status === 3),
        ),
      ),
    [rawLiveMap, today],
  );

  // Game start times for locking slots
  const gameTimeMap = useTodayGameTimes(isToday);

  // Prefetch adjacent days to reduce pop-in when navigating
  useEffect(() => {
    if (!teamId || !leagueId) return;
    const adjacent = [
      addDays(selectedDate, -1),
      addDays(selectedDate, 1),
      addDays(selectedDate, 2),
    ];
    const todayStr = getSportToday(sport);
    for (const day of adjacent) {
      queryClient.prefetchQuery({
        queryKey: queryKeys.teamRoster(teamId, day),
        queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day, sport),
        staleTime: 1000 * 60 * 2,
      });
      if (day >= todayStr) {
        queryClient.prefetchQuery({
          queryKey: [...queryKeys.daySchedule(day), sport],
          queryFn: () => fetchNbaScheduleForDate(day, sport),
          staleTime: 1000 * 60 * 60,
        });
      }
    }
  }, [selectedDate, teamId, leagueId]);

  const dailyAllLocked =
    league?.player_lock_type === "daily" && hasAnyGameStarted(gameTimeMap);

  const isPlayerLocked = (player: RosterPlayer | null): boolean => {
    if (!isToday || !player) return false;
    if (dailyAllLocked) return true;
    const liveStatus = liveMap.get(player.player_id)?.game_status;
    return isGameStarted(player.nbaTricode, gameTimeMap, liveStatus);
  };

  const isLoading = isLoadingConfig || isLoadingRoster;


  // ─── Build slot entries ───────────────────────────────────────────────────

  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];
  const irSlots: SlotEntry[] = [];
  const taxiSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((c) => c.position === "BE");
    const irConfig = rosterConfig.find((c) => c.position === "IR");
    const taxiConfig = rosterConfig.find((c) => c.position === ROSTER_SLOT.TAXI);
    const activeConfigs = rosterConfig.filter(
      (c) =>
        c.position !== "BE" && c.position !== "IR" && c.position !== ROSTER_SLOT.TAXI,
    );

    // Build a set of all valid numbered slot names (PG, SG, UTIL1, UTIL2, etc.)
    const validSlotNames = new Set<string>();
    for (const config of activeConfigs) {
      if (config.position === "UTIL") {
        for (let i = 1; i <= config.slot_count; i++)
          validSlotNames.add(`UTIL${i}`);
      } else {
        validSlotNames.add(config.position);
      }
    }

    // Track which players are placed in starter slots to catch duplicates
    const placedPlayerIds = new Set<string>();

    for (const config of activeConfigs) {
      if (config.position === "UTIL") {
        // Numbered UTIL slots: each player is assigned to a specific UTIL1, UTIL2, etc.
        for (let i = 0; i < config.slot_count; i++) {
          const numberedSlot = `UTIL${i + 1}`;
          const player =
            rosterPlayers.find(
              (p) =>
                p.roster_slot === numberedSlot &&
                !placedPlayerIds.has(p.player_id),
            ) ?? null;
          if (player) placedPlayerIds.add(player.player_id);
          slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
        }
      } else {
        const playersInSlot = rosterPlayers.filter(
          (p) =>
            p.roster_slot === config.position &&
            !placedPlayerIds.has(p.player_id),
        );
        for (let i = 0; i < config.slot_count; i++) {
          const player = playersInSlot[i] ?? null;
          if (player) placedPlayerIds.add(player.player_id);
          slots.push({
            slotPosition: config.position,
            slotIndex: i,
            player,
          });
        }
      }
    }

    for (const player of rosterPlayers) {
      if (player.roster_slot === "IR" || player.roster_slot === ROSTER_SLOT.TAXI)
        continue;
      if (
        !player.roster_slot ||
        player.roster_slot === "BE" ||
        !validSlotNames.has(player.roster_slot) ||
        !placedPlayerIds.has(player.player_id)
      ) {
        benchPlayers.push(player);
      }
    }

    const benchSlotCount = Math.max(
      benchConfig?.slot_count ?? 0,
      benchPlayers.length,
    );
    for (let i = 0; i < benchSlotCount; i++) {
      slots.push({
        slotPosition: "BE",
        slotIndex: i,
        player: benchPlayers[i] ?? null,
      });
    }

    if (irConfig && irConfig.slot_count > 0) {
      const irPlayers = rosterPlayers.filter(
        (p) => p.roster_slot === "IR",
      );
      const irSlotCount = Math.max(irConfig.slot_count, irPlayers.length);
      for (let i = 0; i < irSlotCount; i++) {
        irSlots.push({
          slotPosition: "IR",
          slotIndex: i,
          player: irPlayers[i] ?? null,
        });
      }
    }

    if (taxiConfig && taxiConfig.slot_count > 0) {
      const taxiPlayers = rosterPlayers.filter(
        (p) => p.roster_slot === ROSTER_SLOT.TAXI,
      );
      const taxiSlotCount = Math.max(taxiConfig.slot_count, taxiPlayers.length);
      for (let i = 0; i < taxiSlotCount; i++) {
        taxiSlots.push({
          slotPosition: ROSTER_SLOT.TAXI,
          slotIndex: i,
          player: taxiPlayers[i] ?? null,
        });
      }
    }
  }

  const starterSlots = slots.filter((s) => s.slotPosition !== "BE");
  const benchSlots = slots.filter((s) => s.slotPosition === "BE");

  // Per-starter availability for the selected date — drives the hero's
  // lineup-health bar. Each starter slot falls into exactly one bucket:
  //   playing — has a game today and is active (will score)
  //   out     — OUT/SUSP; dead weight in the lineup, the swap-me signal
  //   idle    — active but their pro team has no game today
  //   empty   — unfilled slot
  let heroPlaying = 0;
  let heroOut = 0;
  let heroIdle = 0;
  let heroEmpty = 0;
  for (const slot of starterSlots) {
    if (!slot.player) {
      heroEmpty += 1;
      continue;
    }
    const player = slot.player;
    const isOut = player.status === "OUT" || player.status === "SUSP";
    const hasGame = !!player.nbaTricode && !!daySchedule?.has(player.nbaTricode);
    if (isOut) heroOut += 1;
    else if (hasGame) heroPlaying += 1;
    else heroIdle += 1;
  }
  const heroLineupDay = {
    playing: heroPlaying,
    out: heroOut,
    idle: heroIdle,
    empty: heroEmpty,
    starterCount: starterSlots.length,
  };

  // Offseason hero stats — only computed/passed when there's no current
  // matchup week. Surfaces roster-management state that Home doesn't cover.
  const heroRosterStats = useMemo(() => {
    if (!rosterPlayers) return undefined;
    const irActive = rosterPlayers.filter((p) => p.roster_slot === "IR").length;
    const taxiActive = rosterPlayers.filter(
      (p) => p.roster_slot === ROSTER_SLOT.TAXI,
    ).length;
    const onBlockCount = rosterPlayers.filter(
      (p) => (p as { on_trade_block?: boolean }).on_trade_block,
    ).length;
    return {
      rosterCount: rosterPlayers.length,
      rosterSize: league?.roster_size ?? 0,
      irCount: irActive,
      taxiCount: taxiActive,
      onBlockCount,
    };
  }, [rosterPlayers, league?.roster_size]);

  // ─── Slot picker helpers ──────────────────────────────────────────────────

  /** Compute destination slots for the selected player (dest mode). */
  const getEligibleDestinations = (): DestinationSlot[] => {
    if (!activeSlot?.player || !rosterPlayers) return [];

    const player = activeSlot.player;
    const srcSlot = activeSlot.slotPosition;
    const srcIsBench = srcSlot === "BE";
    const srcIsStarter =
      srcSlot !== "BE" && srcSlot !== "IR" && srcSlot !== ROSTER_SLOT.TAXI;
    const allSlots = [...starterSlots, ...benchSlots, ...irSlots, ...taxiSlots];
    const destinations: DestinationSlot[] = [];

    for (const s of allSlots) {
      // Skip own slot
      if (
        s.slotPosition === srcSlot &&
        s.slotIndex === activeSlot.slotIndex
      )
        continue;

      const dstIsStarter =
        s.slotPosition !== "BE" &&
        s.slotPosition !== "IR" &&
        s.slotPosition !== ROSTER_SLOT.TAXI;
      const dstIsBench = s.slotPosition === "BE";

      // IR/TAXI destinations handled by quick actions
      if (s.slotPosition === "IR" || s.slotPosition === ROSTER_SLOT.TAXI) continue;

      // Bench → bench makes no sense
      if (dstIsBench && srcIsBench) continue;
      // Empty bench slot is not a useful destination
      if (dstIsBench && !s.player) continue;

      if (dstIsStarter) {
        if (!isEligibleForSlot(player.position, s.slotPosition)) continue;
        // For occupied slots: cross-swap eligibility
        if (s.player && srcIsStarter) {
          if (!isEligibleForSlot(s.player.position, srcSlot)) continue;
        }
        // Bench → occupied starter: displaced player always goes to bench (valid)
        if (s.player && isPlayerLocked(s.player)) continue;
      }

      if (dstIsBench && srcIsStarter) {
        // "Replace with" bench player: must be eligible for source's position
        if (!s.player) continue;
        if (!isEligibleForSlot(s.player.position, srcSlot)) continue;
        if (isPlayerLocked(s.player)) continue;
      }

      const section: DestinationSlot["section"] = dstIsStarter
        ? "starter"
        : dstIsBench
          ? "bench"
          : s.slotPosition === "IR"
            ? "ir"
            : "taxi";

      destinations.push({ slot: s, section });
    }

    return destinations;
  };

  /** Compute quick actions for the selected player (dest mode). */
  const getQuickActions = (): QuickAction[] => {
    if (!activeSlot?.player) return [];
    const player = activeSlot.player;
    const srcSlot = activeSlot.slotPosition;
    const actions: QuickAction[] = [];

    const srcIsStarter =
      srcSlot !== "BE" && srcSlot !== "IR" && srcSlot !== ROSTER_SLOT.TAXI;
    if (srcIsStarter) actions.push("bench");

    if (
      (player.status === "OUT" || player.status === "SUSP") &&
      srcSlot !== "IR" &&
      irSlots.length > 0
    )
      actions.push("ir");

    if (
      srcSlot === "BE" &&
      taxiSlots.length > 0 &&
      canSendToTaxi(
        player.draft_year ?? null,
        league?.season ?? "",
        league?.taxi_max_experience ?? null,
        player.promoted_from_taxi ?? false,
      )
    )
      actions.push("taxi");

    return actions;
  };

  /** Compute eligible players for empty slots or IR/TAXI (fill mode). */
  const getEligibleFillPlayers = (): RosterPlayer[] => {
    if (!activeSlot || !rosterPlayers) return [];
    const slotPos = activeSlot.slotPosition;
    const isIR = slotPos === "IR";
    const isTaxi = slotPos === ROSTER_SLOT.TAXI;
    const currentPlayer = activeSlot.player;

    return rosterPlayers.filter((p) => {
      if (currentPlayer?.player_id === p.player_id) return false;

      // IR: only OUT/SUSP players not already on IR
      if (isIR) {
        return (
          (p.status === "OUT" || p.status === "SUSP") &&
          p.roster_slot !== "IR"
        );
      }

      // TAXI: only bench players who are taxi-eligible and haven't already
      // been promoted off the taxi squad (promotion is one-way).
      if (isTaxi) {
        const isOnBench = !p.roster_slot || p.roster_slot === "BE";
        if (!isOnBench) return false;
        return canSendToTaxi(
          p.draft_year ?? null,
          league?.season ?? "",
          league?.taxi_max_experience ?? null,
          p.promoted_from_taxi ?? false,
        );
      }

      // Empty bench: show starters (to bench them) — rare edge case
      if (slotPos === "BE") {
        return (
          p.roster_slot !== undefined &&
          p.roster_slot !== null &&
          p.roster_slot !== "BE" &&
          p.roster_slot !== "IR" &&
          p.roster_slot !== ROSTER_SLOT.TAXI
        );
      }

      // Empty starter: position-eligible, not on taxi
      if (p.roster_slot === ROSTER_SLOT.TAXI) return false;
      if (!isEligibleForSlot(p.position, slotPos)) return false;
      // Exclude locked players unless IR/TAXI slot
      if (isPlayerLocked(p) && !isIR && !isTaxi) return false;
      return true;
    });
  };

  // ─── Unified roster move handler ──────────────────────────────────────────

  const upsertDailySlot = async (
    playerId: string,
    slot: string,
    dateOverride?: string,
  ) => {
    const { error } = await supabase.from("daily_lineups").upsert(
      {
        league_id: leagueId!,
        team_id: teamId!,
        player_id: playerId,
        lineup_date: dateOverride ?? selectedDate,
        roster_slot: slot,
      },
      { onConflict: "team_id,player_id,lineup_date" },
    );
    if (error) throw error;
  };

  // Supabase update builders don't throw — they resolve with { error }. Without
  // this wrapper the surrounding try/catch never sees RLS/constraint failures
  // and the UI happily proceeds, then snaps back on refetch.
  const runUpdate = async (
    query: PromiseLike<{ error: { message: string } | null }>,
  ) => {
    const { error } = await query;
    if (error) throw error;
  };

  /**
   * Handles all roster moves: swaps, bench, IR, TAXI, promotions, fills.
   * sourcePlayer moves to destSlotPosition. If destPlayer exists, they go to sourceSlotPosition.
   */
  const handleRosterMove = async (
    sourcePlayer: RosterPlayer,
    sourceSlotPosition: string,
    destSlotPosition: string,
    destPlayer: RosterPlayer | null,
  ) => {
    if (!teamId || !leagueId || isPastDate) return;
    if (!(await isOnline())) {
      showToast("error", "No internet connection");
      return;
    }

    const srcIsIR = sourceSlotPosition === "IR";
    const srcIsTaxi = sourceSlotPosition === ROSTER_SLOT.TAXI;
    const dstIsIR = destSlotPosition === "IR";
    const dstIsTaxi = destSlotPosition === ROSTER_SLOT.TAXI;

    // ── IR legality checks ──
    // 1. Can only place a player on IR if they actually qualify for IR.
    if (dstIsIR && !isIrEligibleStatus(sourcePlayer.status)) {
      Alert.alert(
        "IR not allowed",
        `${sourcePlayer.name} is not injured and can't be placed on IR.`,
      );
      return;
    }
    // 2. If the team is locked by an illegal-IR player, only allow moves
    //    that reduce the lockout (moving an illegal-IR player off IR).
    if (irLocked) {
      const resolvesLockout =
        srcIsIR && !dstIsIR && !isIrEligibleStatus(sourcePlayer.status);
      if (!resolvesLockout) {
        const names = (illegalIRPlayers ?? []).map((p) => p.name).join(", ");
        Alert.alert(
          "Roster locked",
          `${names} ${illegalIRPlayers!.length > 1 ? "are" : "is"} on IR but no longer injured. Activate them before making other roster moves.`,
        );
        return;
      }
    }
    // 3. Over-capacity lock: when the team's active roster exceeds the
    //    league cap, only allow moves that REDUCE the active count
    //    (active → IR or active → TAXI). Active↔active swaps and
    //    IR/TAXI→active moves stay blocked until the count is back in
    //    range. Drops are a separate action and aren't affected.
    if (overCapLocked) {
      const reducesActive =
        !srcIsIR && !srcIsTaxi && (dstIsIR || dstIsTaxi);
      if (!reducesActive) {
        Alert.alert(
          "Roster locked",
          `Your active roster is over capacity (${overCap!.activeCount}/${overCap!.rosterSize}). Move ${overCap!.overBy} player${overCap!.overBy === 1 ? "" : "s"} to TAXI or IR — or drop them — before making other moves.`,
        );
        return;
      }
    }

    setIsAssigning(true);
    try {
      const isIrTaxiInvolved = srcIsIR || srcIsTaxi || dstIsIR || dstIsTaxi;

      const deferred =
        isIrTaxiInvolved &&
        (isPlayerLocked(sourcePlayer) || isPlayerLocked(destPlayer));
      const effectiveDate = deferred ? addDays(today, 1) : selectedDate;

      // ── 0. Pin today's slot when deferred ──
      // When a game is in progress, the move doesn't take effect until tomorrow.
      // Lock the player's current slot into today's daily_lineups so resolveSlot
      // returns the old slot for today (instead of falling back to league_players).
      if (deferred) {
        await upsertDailySlot(sourcePlayer.player_id, sourceSlotPosition, today);
        if (destPlayer) {
          await upsertDailySlot(destPlayer.player_id, destSlotPosition, today);
        }
      }

      // ── 1. Displace destination player ──
      if (destPlayer) {
        if (dstIsIR) {
          await upsertDailySlot(destPlayer.player_id, "BE", effectiveDate);
          await runUpdate(
            supabase
              .from("daily_lineups")
              .update({ roster_slot: "BE" })
              .eq("team_id", teamId)
              .eq("league_id", leagueId)
              .eq("player_id", destPlayer.player_id)
              .eq("roster_slot", "IR")
              .gt("lineup_date", effectiveDate),
          );
          await runUpdate(
            supabase
              .from("league_players")
              .update({ roster_slot: "BE" })
              .eq("league_id", leagueId)
              .eq("team_id", teamId)
              .eq("player_id", destPlayer.player_id),
          );
        } else if (dstIsTaxi) {
          await upsertDailySlot(destPlayer.player_id, "BE", effectiveDate);
          await runUpdate(
            supabase
              .from("league_players")
              .update({ roster_slot: "BE" })
              .eq("league_id", leagueId)
              .eq("team_id", teamId)
              .eq("player_id", destPlayer.player_id),
          );
        } else {
          // Normal swap: displaced player goes to source slot
          await upsertDailySlot(destPlayer.player_id, sourceSlotPosition);
        }
      }

      // ── 2. Move source player to destination ──
      await upsertDailySlot(
        sourcePlayer.player_id,
        destSlotPosition,
        isIrTaxiInvolved ? effectiveDate : undefined,
      );

      // ── 3. Update future entries + league_players for IR/TAXI ──
      if (dstIsIR) {
        await runUpdate(
          supabase
            .from("daily_lineups")
            .update({ roster_slot: "IR" })
            .eq("team_id", teamId)
            .eq("league_id", leagueId)
            .eq("player_id", sourcePlayer.player_id)
            .gt("lineup_date", effectiveDate),
        );
        await runUpdate(
          supabase
            .from("league_players")
            .update({ roster_slot: "IR" })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", sourcePlayer.player_id),
        );
      } else if (dstIsTaxi) {
        await runUpdate(
          supabase
            .from("league_players")
            .update({ roster_slot: ROSTER_SLOT.TAXI, promoted_from_taxi: false })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", sourcePlayer.player_id),
        );
      } else if (srcIsIR) {
        await runUpdate(
          supabase
            .from("daily_lineups")
            .update({ roster_slot: "BE" })
            .eq("team_id", teamId)
            .eq("league_id", leagueId)
            .eq("player_id", sourcePlayer.player_id)
            .eq("roster_slot", "IR")
            .gt("lineup_date", effectiveDate),
        );
        await runUpdate(
          supabase
            .from("league_players")
            .update({ roster_slot: destSlotPosition })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", sourcePlayer.player_id),
        );
      } else if (srcIsTaxi) {
        await runUpdate(
          supabase
            .from("daily_lineups")
            .update({ roster_slot: "BE" })
            .eq("team_id", teamId)
            .eq("league_id", leagueId)
            .eq("player_id", sourcePlayer.player_id)
            .eq("roster_slot", ROSTER_SLOT.TAXI)
            .gt("lineup_date", effectiveDate),
        );
        // Promotion off the taxi squad is one-way: flag the player so they
        // can't be sent back to taxi (see getQuickActions / getEligibleFillPlayers).
        await runUpdate(
          supabase
            .from("league_players")
            .update({ roster_slot: destSlotPosition, promoted_from_taxi: true })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", sourcePlayer.player_id),
        );
      }

      // ── 4. Query invalidation ──
      if (isIrTaxiInvolved) {
        queryClient.invalidateQueries({
          queryKey: ["illegal-ir", leagueId, teamId],
        });
        queryClient.invalidateQueries({
          queryKey: ["over-cap", leagueId, teamId],
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.rosterInfo(leagueId, teamId),
        });
        queryClient.invalidateQueries({
          queryKey: ["teamRoster", teamId],
        });
        for (const day of [
          addDays(effectiveDate, 0),
          addDays(effectiveDate, 1),
          addDays(effectiveDate, 2),
        ]) {
          queryClient.prefetchQuery({
            queryKey: queryKeys.teamRoster(teamId, day),
            queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day, sport),
            staleTime: 1000 * 30,
          });
        }
        if (deferred) {
          showToast(
            "info",
            "Game already started — this change takes effect tomorrow",
          );
        }
      } else {
        queryClient.invalidateQueries({
          queryKey: queryKeys.teamRoster(teamId, selectedDate),
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["weekMatchup", leagueId],
      });
      capture('lineup_change');
      setActiveSlot(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to move player";
      Alert.alert("Error", message);
    } finally {
      setIsAssigning(false);
    }
  };

  // ─── Auto-lineup optimizer ──────────────────────────────────────────────

  const promptAutoLineup = () => {
    if (
      !rosterPlayers ||
      !rosterConfig ||
      !scoringWeights ||
      !teamId ||
      !leagueId
    )
      return;

    const autoLineupActions: ModalAction[] = [
      {
        id: "today",
        label: "Today Only",
        icon: "today-outline",
        onPress: () => runAutoLineup("today"),
      },
      {
        id: "week",
        label: "Rest of Week",
        icon: "calendar-outline",
        onPress: () => runAutoLineup("week"),
      },
    ];
    // Surface the ranking basis so it's clear auto-sort follows the stat
    // window the user is currently viewing (L5/L10/L15 → recent form;
    // Season → season averages; Proj → next-game projections).
    const basisLabel =
      windowSel === "proj"
        ? "NEXT-GAME PROJECTIONS"
        : windowSel === "prev"
          ? "LAST SEASON AVERAGES"
          : windowSel === "season"
            ? "SEASON AVERAGES"
            : `LAST ${gameWindowSize(windowSel)} GAMES`;
    pickAction({
      title: "Auto-Lineup",
      subtitle: `OPTIMIZE BY ${basisLabel}`,
      actions: autoLineupActions,
    });
  };

  const runAutoLineup = async (mode: "today" | "week") => {
    if (
      !rosterPlayers ||
      !rosterConfig ||
      !scoringWeights ||
      !teamId ||
      !leagueId
    )
      return;
    if (!(await isOnline())) {
      showToast("error", "No internet connection");
      return;
    }

    // Lineup edits are blocked while either lock is active. Auto-lineup
    // is a bulk lineup edit so the same gates apply — without these the
    // user could circumvent the per-move drag-drop guards by tapping
    // "Optimize" instead.
    if (!(await guardIllegalIR(leagueId, teamId))) return;
    if (!(await guardOverCap(leagueId, teamId))) return;

    setIsOptimizing(true);
    try {
      // 1. Build date range based on mode
      const dates: string[] = [];
      if (mode === "today") {
        dates.push(today);
      } else {
        const startDate = currentWeek?.start_date ?? today;
        const endDate = currentWeek?.end_date ?? today;
        let cursor = startDate > today ? startDate : today;
        while (cursor <= endDate) {
          dates.push(cursor);
          cursor = addDays(cursor, 1);
        }
      }

      if (dates.length === 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      // 2. Batch-fetch the league's pro schedule for the date range. Sport +
      // season filters are required so a WNBA league doesn't pull NBA games
      // (and vice-versa) for tricodes that collide across both pools.
      const { data: nbaGames } = await supabase
        .from("game_schedule")
        .select("game_date, home_team, away_team")
        .eq("sport", sport)
        .eq("season", getCurrentSeason(sport))
        .not("game_id", "like", "001%")
        .gte("game_date", dates[0])
        .lte("game_date", dates[dates.length - 1]);

      const teamsPlayingByDate = new Map<string, Set<string>>();
      for (const game of nbaGames ?? []) {
        let teams = teamsPlayingByDate.get(game.game_date);
        if (!teams) {
          teams = new Set();
          teamsPlayingByDate.set(game.game_date, teams);
        }
        teams.add(game.home_team);
        teams.add(game.away_team);
      }

      // Previous-season fallback: until a player has a meaningful current-
      // season sample, the optimizer treats everyone as 0 fpts and produces
      // an arbitrary lineup (especially during WNBA pre-tipoff). Pull last
      // season's averages and use them as the rank input until the current
      // sample crosses MIN_CURRENT_SEASON_GAMES — ~25% of a WNBA season,
      // ~12% of an NBA season — enough to be predictive without overweighting
      // small early-season samples.
      const MIN_CURRENT_SEASON_GAMES = 10;
      const prevSeasonFptsMap = new Map<string, number>();
      const prevSeasonStatsMap = new Map<string, PlayerSeasonStats>();
      const playersNeedingFallback = rosterPlayers.filter(
        (p) => (p.games_played ?? 0) < MIN_CURRENT_SEASON_GAMES,
      );
      // Pull last season's stats for under-sampled players regardless of
      // scoring type. Points leagues rank by the fpts derived from these rows;
      // category leagues feed the raw rows into the composite below. Without
      // this, early-season cat lineups (and WNBA pre-tipoff) rank everyone off
      // near-empty current stats and produce an arbitrary lineup.
      if (playersNeedingFallback.length > 0) {
        const { data: histRows } = await supabase
          .from("player_historical_stats")
          .select("*")
          .eq("sport", sport)
          .eq("season", getPreviousSeason(sport))
          .in(
            "player_id",
            playersNeedingFallback.map((p) => p.player_id),
          );
        for (const h of histRows ?? []) {
          if (!h.player_id) continue;
          const row = h as unknown as PlayerSeasonStats;
          prevSeasonStatsMap.set(h.player_id, row);
          const fpts = calculateAvgFantasyPoints(row, scoringWeights);
          if (fpts > 0) prevSeasonFptsMap.set(h.player_id, fpts);
        }
      }

      // Projection fallback (preferred over raw prev-season averages): the
      // projections engine blends prior + current-season data and absorbs
      // injuries / role changes, so for under-sampled players we rank by
      // projected fpts before falling back to last season's flat average.
      // Points-league only — the category composite (below) keeps using the
      // historical row, which carries the shooting splits the game-by-game
      // projection doesn't model.
      const projFptsMap = new Map<string, number>();
      if (!isCategories && playersNeedingFallback.length > 0) {
        const { data: projRows } = await supabase
          .from("current_player_projections")
          .select("*")
          .eq("sport", sport)
          .eq("horizon", "next_game")
          .in(
            "player_id",
            playersNeedingFallback.map((p) => p.player_id),
          );
        for (const pr of projRows ?? []) {
          if (!pr.player_id) continue;
          const fpts = projAvgRowToFpts(pr as Record<string, unknown>, scoringWeights);
          if (fpts > 0) projFptsMap.set(pr.player_id, fpts);
        }
      }

      // 3. Optimize each day. Write ALL players for ALL days so stale entries
      //    from previous runs get overwritten (upsert key is per-player+date).
      const allRows: {
        league_id: string;
        team_id: string;
        player_id: string;
        lineup_date: string;
        roster_slot: string;
      }[] = [];

      // Start from the current effective lineup (feeds into each day's optimizer)
      const prevSlots = new Map(
        rosterPlayers.map((p) => [p.player_id, p.roster_slot ?? "BE"]),
      );
      let totalMoves = 0;
      let daysChanged = 0;

      // The roster's stat-window selector (L5/L10/L15/Season) doubles as the
      // ranking basis for auto-lineup: optimizing while looking at "Last 10"
      // sorts by last-10 form, not season averages. Season → unchanged. When
      // a window is set but a player has no game log (fresh acquisition), each
      // path falls back to its season/prev-season value so nobody zeroes out.
      const windowedFptsFor = (p: RosterPlayer): number | null =>
        winSize != null
          ? windowFantasyPoints(rosterLogsByPlayer?.get(p.player_id), scoringWeights, winSize)
          : null;

      // For CAT leagues, rank players by composite z-score instead of FPTS.
      // Shift all values so the minimum is at least 1, because the optimizer
      // treats 0 as "no game today" — negative z-scores would rank below
      // players with no game, breaking the lineup.
      const catRankMap = new Map<string, number>();
      if (isCategories && rosterPlayers.length >= 3) {
        // Per-player ranking row, in priority order:
        //   1. windowed slice (when a window is active + the log has games)
        //   2. last season's stats (under-sampled current season)
        //   3. the player's own current-season row
        const statsForComposite = rosterPlayers.map((p) => {
          if (winSize != null) {
            const windowed = buildWindowedStatRow(
              p,
              rosterLogsByPlayer?.get(p.player_id),
              winSize,
            );
            if (windowed) return windowed;
          }
          return (p.games_played ?? 0) >= MIN_CURRENT_SEASON_GAMES
            ? p
            : (prevSeasonStatsMap.get(p.player_id) ?? p);
        });
        const composite = buildCompositeScatter(statsForComposite);
        const minVal = composite.reduce(
          (m, pt) => Math.min(m, pt.value),
          Infinity,
        );
        const shift = minVal < 1 ? 1 - minVal : 0;
        for (const pt of composite) {
          catRankMap.set(pt.playerId, pt.value + shift);
        }
      }

      for (const date of dates) {
        const teamsPlaying = teamsPlayingByDate.get(date);
        const isDateToday = date === today;

        // If no roster player has a game on this date (WNBA pre-tipoff, NBA
        // off-day, all-star break, dynasty offseason), the optimizer would
        // see dayFpts = 0 for everyone and produce an arbitrary lineup. In
        // that case, treat all players as having a game so they get ranked
        // by avgFpts directly — gives the user a sensible "default" lineup
        // they can keep when real games resume.
        const noRosterGamesToday = !rosterPlayers.some(
          (p) => teamsPlaying?.has(p.nbaTricode ?? "") ?? false,
        );

        const lineupPlayers: LineupPlayer[] = rosterPlayers.map(
          (p) => {
            const hasMeaningfulSample =
              (p.games_played ?? 0) >= MIN_CURRENT_SEASON_GAMES;
            const currentFpts = calculateAvgFantasyPoints(p, scoringWeights);
            const projFpts = projFptsMap.get(p.player_id) ?? 0;
            const fallbackFpts = prevSeasonFptsMap.get(p.player_id) ?? 0;
            // "Proj" view: rank directly by the next-game projection (the same
            // number shown next to the game), falling back to current/prev when
            // a player isn't projected yet.
            const projRow = nextGameProjections?.get(p.player_id);
            const projRankFpts =
              projRow && scoringWeights
                ? projAvgRowToFpts(projRow as Record<string, unknown>, scoringWeights)
                : 0;
            // Points-league ranking: windowed form when a window is active
            // (and the log has games), else current season once it's a
            // meaningful sample, else the projection, else last season, else
            // whatever current value we have.
            const windowedFpts = windowedFptsFor(p);
            return {
              player_id: p.player_id,
              position: p.position,
              status: p.status,
              roster_slot: prevSlots.get(p.player_id) ?? "BE",
              avgFpts: isCategories
                ? catRankMap.get(p.player_id) ?? 0
                : isProjMode
                  ? projRankFpts || currentFpts || fallbackFpts
                  : isPrevMode
                    ? (prevSeasonFpts?.get(p.player_id) ?? 0) || currentFpts || projRankFpts
                    : windowedFpts != null
                      ? windowedFpts
                      : hasMeaningfulSample
                        ? currentFpts
                        : projFpts || fallbackFpts || currentFpts,
              locked: isDateToday ? isPlayerLocked(p) : false,
              hasGame: noRosterGamesToday
                ? true
                : teamsPlaying?.has(p.nbaTricode ?? "") ?? false,
            };
          },
        );

        const assignments = optimizeLineup(lineupPlayers, rosterConfig);

        // Track actual changes vs previous day's state
        let dayMoves = 0;
        for (const a of assignments) {
          if (a.slot !== prevSlots.get(a.player_id)) dayMoves++;
        }
        totalMoves += dayMoves;
        if (dayMoves > 0) daysChanged++;

        // Write every player's slot for this date — overwrites any stale entries
        for (const a of assignments) {
          allRows.push({
            league_id: leagueId,
            team_id: teamId,
            player_id: a.player_id,
            lineup_date: date,
            roster_slot: a.slot,
          });
        }

        // Feed this day's result into the next day's optimizer
        for (const a of assignments) {
          prevSlots.set(a.player_id, a.slot);
        }
      }

      if (totalMoves === 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Lineup Already Optimal", "No changes needed.");
        return;
      }

      // 4. Batch upsert all daily lineups across all days
      const { error } = await supabase
        .from("daily_lineups")
        .upsert(allRows, { onConflict: "team_id,player_id,lineup_date" });
      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Lineup Optimized",
        `${totalMoves} move${totalMoves === 1 ? "" : "s"} across ${daysChanged} day${daysChanged === 1 ? "" : "s"}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId] });
      queryClient.invalidateQueries({ queryKey: ["weekMatchup", leagueId] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to optimize lineup";
      Alert.alert("Error", message);
    } finally {
      setIsOptimizing(false);
    }
  };

  // ─── FPTS / stat resolution per player ───────────────────────────────────

  // Returns { fpts, statLine, isLive, matchup } for display in a slot row.
  // fpts === null means no game on that date — show "—" and exclude from totals.
  const resolveSlotStats = (player: RosterPlayer | null): SlotStats =>
    computeSlotStats(player, {
      scoringWeights,
      isToday,
      isPastDate,
      isCategories,
      liveMap,
      daySchedule,
      dayGameStats,
    });

  // Pre-formatted next-game projected fpts for a player, e.g. "18.3" — or null
  // when there's no usable projection (no row, 0, categories, no weights).
  // Drives both the inline next-to-game readout and the "Proj" context mode.
  const projFptsFor = (playerId: string): string | null => {
    if (isCategories || !scoringWeights || !nextGameProjections) return null;
    const pr = nextGameProjections.get(playerId);
    if (!pr) return null;
    const fpts = projAvgRowToFpts(pr as Record<string, unknown>, scoringWeights);
    return fpts > 0 ? fpts.toFixed(1) : null;
  };

  // A next-game projection shaped like a SeasonAverages so SeasonMetaLine can
  // render it in the context slot (labeled PROJ) when the window picker is on
  // "Proj". Null when there's no usable projection — caller falls back to avg.
  const projToContext = (pr: ProjectionRow | undefined): SeasonAverages | null => {
    if (!pr || !scoringWeights) return null;
    const fpts = projAvgRowToFpts(pr as Record<string, unknown>, scoringWeights);
    if (fpts <= 0) return null;
    const stats = `${(pr.proj_pts ?? 0).toFixed(1)}P/${(pr.proj_reb ?? 0).toFixed(1)}R/${(pr.proj_ast ?? 0).toFixed(1)}A`;
    return { stats, fpts: fpts.toFixed(1) };
  };

  // Last season's fpts/G as a SeasonAverages for the "Prev" context mode (the
  // fpts is all the prev-season hook carries; `stats` stays empty and is never
  // shown since SeasonMetaLine renders the fpts). Null when no prior-season row.
  const prevToContext = (playerId: string): SeasonAverages | null => {
    const fpts = prevSeasonFpts?.get(playerId);
    return fpts && fpts > 0 ? { stats: "", fpts: fpts.toFixed(1) } : null;
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  // Horizontal swipe to flip days. Threshold + velocity check so a casual
  // brush doesn't trigger a navigation; failOffsetY keeps the vertical
  // ScrollView intact. Arrow buttons in the hero stay live in parallel.
  const swipeDay = (delta: -1 | 1) => {
    if (delta === -1 && !canGoBack) return;
    setSelectedDate(addDays(selectedDate, delta));
  };
  const dayPan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onEnd((e) => {
      const SWIPE_DIST = 60;
      const SWIPE_VEL = 500;
      const horizontalEnough =
        Math.abs(e.translationX) > SWIPE_DIST || Math.abs(e.velocityX) > SWIPE_VEL;
      if (!horizontalEnough) return;
      if (Math.abs(e.translationX) < Math.abs(e.translationY)) return;
      if (e.translationX < 0) runOnJS(swipeDay)(1);
      else runOnJS(swipeDay)(-1);
    });

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <View style={styles.centered}><LogoSpinner /></View>
      </SafeAreaView>
    );
  }

  if (isRosterError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <ErrorState
          message="Failed to load roster"
          onRetry={() => refetchRoster()}
        />
      </SafeAreaView>
    );
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <GestureDetector gesture={dayPan}>
          <View style={{ flex: 1 }}>
        {/* Hero — always visible so users aren't trapped on an empty date */}
        <RosterHero
          selectedDate={selectedDate}
          today={today}
          canGoBack={canGoBack}
          isPastDate={isPastDate}
          isToday={isToday}
          currentWeek={currentWeek}
          dayLabel={formatDayLabel(selectedDate)}
          myTeam={heroMatchup?.me ?? null}
          opponent={heroMatchup?.opponent ?? null}
          isBye={heroMatchup?.isBye ?? false}
          myScore={heroMyScore}
          oppScore={heroOppScore}
          isCategories={isCategories}
          categoryRecord={heroCategoryRecord}
          weekIsLive={weekIsLive}
          rosterStats={heroRosterStats}
          onPrevDay={() =>
            canGoBack && setSelectedDate(addDays(selectedDate, -1))
          }
          onNextDay={() => setSelectedDate(addDays(selectedDate, 1))}
          onGoToToday={() => setSelectedDate(today)}
        />

        <View style={styles.centered}>
          <ThemedText style={{ color: c.secondaryText }}>
            No players on your roster yet.
          </ThemedText>
        </View>
          </View>
        </GestureDetector>
      </SafeAreaView>
    );
  }

  const starterTotal = scoringWeights
    ? starterSlots.reduce((sum, slot) => {
        if (!slot.player) return sum;
        const { fpts, isLive } = resolveSlotStats(slot.player);
        // On today, only count games that are actually live or finished
        if (isToday && !isLive && fpts !== null) {
          const live = liveMap.get(slot.player.player_id);
          if (!live) return sum;
        }
        return fpts !== null ? sum + fpts : sum;
      }, 0)
    : null;

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const { fpts, statLine, isLive, matchup, gameTimeUtc, didNotPlay } =
      resolveSlotStats(slot.player);
    // Pre-game = player has a scheduled matchup that hasn't started yet
    // (future date, or today before tipoff with no live data and no statLine).
    // In that state we keep the position label under the name and surface the
    // upcoming-game chip in the FPTS column instead of a meaningless "0.0".
    const isPreGame =
      !!matchup && !isLive && !statLine && (isToday || isFutureDate);
    const matchupDisplay = matchup
      ? gameTimeUtc && !isLive
        ? `${matchup} · ${formatGameTime(gameTimeUtc)}`
        : matchup
      : null;
    const liveData = slot.player ? liveMap.get(slot.player.player_id) : null;
    const isOnCourt = !!(liveData?.oncourt && liveData.game_status === 2);
    const gameInfo = liveData ? formatGameInfo(liveData) : "";
    // Season context on rows with no actual stats for the date (pre-game and
    // no-game): a single line beside the position — the fpts average (points
    // leagues) or the box score (category leagues, which have no fpts). Null
    // for 0-game players. Suppressed on past dates: the average is forward-
    // looking lineup context, so it just reads as noise on a locked final day.
    const seasonAvg =
      slot.player && !isLive && !statLine && !isPastDate
        ? buildSeasonAverages(
            slot.player,
            scoringWeights,
            isCategories,
            winSize != null
              ? {
                  gameLog: rosterLogsByPlayer?.get(slot.player.player_id),
                  windowSize: winSize,
                }
              : undefined,
          )
        : null;
    // "Proj"/"Prev" windows swap the context number for the next-game projection
    // (PROJ) or last season's average (PREV). Each falls back to the season
    // average when that player has no projection / prior-season row.
    const forwardOk =
      slot.player && !isLive && !statLine && !isPastDate;
    const projContext =
      isProjMode && forwardOk
        ? projToContext(nextGameProjections?.get(slot.player!.player_id))
        : null;
    const prevContext =
      isPrevMode && forwardOk ? prevToContext(slot.player!.player_id) : null;
    const contextAvg = projContext ?? prevContext ?? seasonAvg;
    const contextLabel = projContext
      ? "PROJ"
      : prevContext
        ? prevSeasonLabel
        : "FPTS/G";
    // Inline projection next to the upcoming game (right column) — independent
    // of the window picker, so it shows whenever a player actually has a game.
    const upcomingProj =
      isPreGame && slot.player ? projFptsFor(slot.player.player_id) : null;
    const isIrOrTaxi =
      slot.slotPosition === "IR" || slot.slotPosition === ROSTER_SLOT.TAXI;
    // Empty slots have no player to lock, but in daily-lock mode after the
    // first game starts, no players are eligible to fill them — so treat the
    // empty slot itself as locked to avoid opening a picker with no options.
    const locked = slot.player
      ? isPlayerLocked(slot.player)
      : isToday && dailyAllLocked;

    const isActive =
      activeSlot?.slotPosition === slot.slotPosition &&
      activeSlot?.slotIndex === slot.slotIndex;

    // Can this slot be edited from the current view? Past days are read-only,
    // and on today a slot locks once its game starts (IR/TAXI stay editable).
    // Drives the pill's tappable-vs-receded styling so locked/past slots read
    // as inert rather than mimicking an editable chip.
    const canEdit = !isPastDate && (!locked || isIrOrTaxi);
    const pill = slotPillVariant(c, {
      canEdit,
      isActive,
      hasPlayer: !!slot.player,
    });

    return (
      <View
        key={`${slot.slotPosition}-${slot.slotIndex}`}
        style={[
          styles.slotRow,
          idx % 2 === 1 && { backgroundColor: c.cardAlt },
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {/* Slot pill — a bordered chip when editable, receding to a flat,
            dimmed label when read-only (past day or game already started). */}
        <TouchableOpacity
          style={[styles.slotPill, pill.container]}
          onPress={() => canEdit && setActiveSlot(slot)}
          accessibilityRole="button"
          accessibilityLabel={`${slotLabel(slot.slotPosition)} slot${slot.player ? `, ${slot.player.name}` : ", empty"}`}
          accessibilityState={{
            selected: isActive,
            disabled: !canEdit,
          }}
          accessibilityHint={canEdit ? "Opens slot picker" : undefined}
        >
          <ThemedText
            type="varsitySmall"
            style={[styles.slotPillText, { color: pill.textColor }]}
          >
            {slotLabel(slot.slotPosition)}
          </ThemedText>
        </TouchableOpacity>

        {slot.player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(slot.player)}
            onLongPress={() => {
              if (isPastDate || (locked && !isIrOrTaxi)) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveSlot(slot);
            }}
            delayLongPress={400}
            accessibilityRole="button"
            accessibilityLabel={`${slot.player!.name}, ${formatPosition(slot.player!.position)}, ${slot.player!.pro_team}${matchupDisplay ? `, ${matchupDisplay}` : ""}${didNotPlay ? ", did not play" : ""}${seasonAvg ? `, season average ${seasonAvg.fpts ? `${seasonAvg.fpts} fantasy points per game, ` : ""}${seasonAvg.stats}` : ""}${!isCategories && fpts !== null ? `, ${formatScore(fpts)} fantasy points` : ""}${isLive ? ", live" : ""}${locked ? ", locked" : ""}`}
            accessibilityHint="Tap for player details, long press to change slot"
          >
            {/* Headshot + team pill + on-court dot (all anchored to the wrap) */}
            <View style={styles.rosterPortraitWrap} accessible={false}>
              <View
                style={[
                  styles.rosterHeadshotCircle,
                  {
                    borderColor: c.heritageGold,
                    backgroundColor: c.cardAlt,
                  },
                ]}
                accessible={false}
              >
                <PlayerHeadshotImage
                  externalIdNba={slot.player.external_id_nba}
                  sport={sport}
                  style={styles.rosterHeadshotImg}
                  accessible={false}
                />
              </View>
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.pro_team, sport);
                return (
                  <View style={styles.rosterTeamPill}>
                    {logoUrl && (
                      <Image
                        source={{ uri: logoUrl }}
                        style={styles.rosterTeamPillLogo}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        recyclingKey={logoUrl}
                      />
                    )}
                    <Text style={[styles.rosterTeamPillText, { color: c.statusText }]}>
                      {slot.player.pro_team}
                    </Text>
                  </View>
                );
              })()}
            </View>

            {/* Player info column */}
            <View style={styles.slotPlayerInfo}>
              {/* Name + injury badge. On-court dot leads the line (replaces the
                  old green portrait border) so the live cue matches the matchup
                  page. */}
              <View style={styles.slotLine1}>
                {isOnCourt && <OnCourtDot />}
                <ThemedText
                  type="defaultSemiBold"
                  style={[styles.slotPlayerName, { flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {slot.player.name}
                </ThemedText>
                {(() => {
                  const badge = getInjuryBadge(slot.player.status);
                  return badge ? (
                    <View
                      style={[
                        styles.liveBadge,
                        { backgroundColor: badge.color },
                      ]}
                    >
                      <Text style={[styles.liveText, { color: c.statusText }]}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
              </View>

              {/* Context line. Live/final: matchup chip + game info. Otherwise
                  the position with the season fpts average beside it — the game
                  itself lives in its own section on the right. */}
              {matchupDisplay && !isPreGame ? (
                <View style={styles.slotMatchupRow}>
                  <MatchupChip matchup={matchupDisplay} isLive={isLive} c={c} />
                  {gameInfo ? (
                    <ThemedText
                      type="varsitySmall"
                      style={[
                        styles.matchupChipMeta,
                        { color: isLive ? c.success : c.secondaryText },
                      ]}
                      numberOfLines={1}
                    >
                      {gameInfo}
                    </ThemedText>
                  ) : didNotPlay ? (
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.matchupChipMeta, { color: c.secondaryText }]}
                      numberOfLines={1}
                    >
                      DNP
                    </ThemedText>
                  ) : null}
                </View>
              ) : (
                <SeasonMetaLine
                  position={slot.player.position}
                  seasonAvg={contextAvg}
                  valueLabel={contextLabel}
                  c={c}
                />
              )}

              {/* Mono detail line — actual game stats on played days. */}
              {statLine ? (
                <ThemedText
                  style={[styles.slotStatLine, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {statLine}
                </ThemedText>
              ) : null}
            </View>

            {/* Right column — opponent pill + tipoff time on pre-game rows;
                animated FPTS readout on live/final. */}
            {isPreGame ? (
              <UpcomingGame
                matchup={matchup!}
                gameTimeUtc={gameTimeUtc}
                projFpts={upcomingProj}
                c={c}
              />
            ) : null}
            {!isCategories && !isPreGame &&
              (() => {
                const isProjected = isFutureDate;
                const canBreakdown =
                  fpts !== null && !isProjected && scoringWeights;
                const handleFptsPress = canBreakdown
                  ? () => {
                      let gameStats: Record<string, number | boolean> | null =
                        null;
                      if (liveData) {
                        gameStats = liveToGameLog(liveData) as Record<
                          string,
                          number | boolean
                        >;
                      } else if (isPastDate) {
                        const dayGame = dayGameStats?.get(
                          slot.player!.player_id,
                        );
                        if (dayGame) gameStats = dayToStatRecord(dayGame);
                      }
                      if (gameStats) {
                        setFptsBreakdown({
                          stats: gameStats,
                          playerName: slot.player!.name,
                          gameLabel: matchup ?? "",
                        });
                      }
                    }
                  : undefined;

                return handleFptsPress ? (
                  <TouchableOpacity
                    onPress={handleFptsPress}
                    accessibilityRole="button"
                    accessibilityLabel={`View breakdown: ${fpts} fantasy points`}
                  >
                    <AnimatedFpts
                      value={fpts}
                      accentColor={c.gold}
                      dimColor={c.secondaryText}
                      textStyle={styles.slotFpts}
                      animate={isToday}
                      projected={false}
                    />
                  </TouchableOpacity>
                ) : (
                  <AnimatedFpts
                    value={fpts}
                    accentColor={c.gold}
                    dimColor={c.secondaryText}
                    textStyle={styles.slotFpts}
                    animate={isToday}
                    projected={isProjected}
                  />
                );
              })()}
          </TouchableOpacity>
        ) : isPastDate ? (
          <View
            style={styles.slotPlayer}
            accessible
            accessibilityLabel={`Empty ${slotLabel(slot.slotPosition)} slot`}
          />
        ) : (
          <TouchableOpacity
            style={[styles.slotPlayer, !canEdit && { opacity: 0.6 }]}
            onPress={() => canEdit && setActiveSlot(slot)}
            accessibilityRole="button"
            accessibilityLabel={
              canEdit
                ? `Empty ${slotLabel(slot.slotPosition)} slot, tap to assign`
                : `Empty ${slotLabel(slot.slotPosition)} slot, locked — game already started`
            }
            accessibilityState={{ disabled: !canEdit }}
            accessibilityHint={
              canEdit ? "Opens slot picker to assign a player" : undefined
            }
          >
            <View style={styles.rosterPortraitWrap}>
              <View
                style={[
                  styles.emptyHeadshot,
                  { borderColor: c.border, backgroundColor: c.cardAlt },
                ]}
              >
                {canEdit && (
                  <Ionicons name="add" size={20} color={c.secondaryText} />
                )}
              </View>
            </View>
            <View style={styles.slotPlayerInfo}>
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.emptySlotEyebrow,
                  { color: canEdit ? c.gold : c.secondaryText },
                ]}
              >
                {canEdit ? "OPEN SLOT" : "LOCKED"}
              </ThemedText>
              <ThemedText
                style={[styles.emptySlotHint, { color: c.secondaryText }]}
              >
                {canEdit ? "Tap to assign a player" : "Game started"}
              </ThemedText>
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <GestureDetector gesture={dayPan}>
        <View style={{ flex: 1 }}>
      <RosterHero
        selectedDate={selectedDate}
        today={today}
        canGoBack={canGoBack}
        isPastDate={isPastDate}
        isToday={isToday}
        currentWeek={currentWeek}
        seasonOpensLabel={seasonOpensLabel}
        dayLabel={formatDayLabel(selectedDate)}
        myTeam={heroMatchup?.me ?? null}
        opponent={heroMatchup?.opponent ?? null}
        isBye={heroMatchup?.isBye ?? false}
        myScore={heroMyScore}
        oppScore={heroOppScore}
        isCategories={isCategories}
        categoryRecord={heroCategoryRecord}
        weekIsLive={weekIsLive}
        lineupDay={heroLineupDay}
        rosterStats={heroRosterStats}
        onPrevDay={() =>
          canGoBack && setSelectedDate(addDays(selectedDate, -1))
        }
        onNextDay={() => setSelectedDate(addDays(selectedDate, 1))}
        onGoToToday={() => setSelectedDate(today)}
        onDatePress={currentWeek ? () => setShowDayPicker(true) : undefined}
        onWeekPress={currentWeek ? () => setShowWeekSummary(true) : undefined}
        headerRight={
          <TouchableOpacity
            onPress={shareRoster}
            disabled={isSharing}
            style={styles.heroShareBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Share roster as image"
            accessibilityState={{ disabled: isSharing }}
          >
            {isSharing ? (
              <LogoSpinner size={14} delay={0} />
            ) : (
              <Ionicons name="share-outline" size={14} color={Brand.vintageGold} />
            )}
          </TouchableOpacity>
        }
      />

      {irLocked && <IrLockBanner players={illegalIRPlayers ?? []} />}
      {overCapLocked && overCap && (
        <OverCapBanner
          activeCount={overCap.activeCount}
          rosterSize={overCap.rosterSize}
          overBy={overCap.overBy}
        />
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Share-capturable roster content */}
        <View ref={shareRef} collapsable={false} style={{ backgroundColor: c.background }}>
        {/* Starters */}
        <View style={styles.section}>
          <SectionEyebrow
            label="STARTERS"
            leftAccessory={
              canAutoLineup ? (
                <TouchableOpacity
                  onPress={promptAutoLineup}
                  disabled={isOptimizing}
                  style={[
                    styles.headerPill,
                    { backgroundColor: c.cardAlt, borderColor: c.gold },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Auto-optimize lineup"
                  accessibilityState={{ disabled: isOptimizing }}
                  accessibilityHint="Choose to optimize lineup for today or the rest of the week"
                >
                  {isOptimizing ? (
                    <LogoSpinner size={14} delay={0} />
                  ) : (
                    <Ionicons name="flash" size={12} color={c.gold} />
                  )}
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.headerPillLabel, { color: c.gold }]}
                  >
                    AUTO
                  </ThemedText>
                </TouchableOpacity>
              ) : null
            }
            right={
              <>
                <RosterWindowPicker
                  windowSel={windowSel}
                  onWindowChange={setWindowSel}
                  availableWindows={availableWindows}
                  prevLabel={prevSeasonLabel}
                />
                {!isCategories && starterTotal !== null && (
                  <View
                    style={[
                      styles.headerPill,
                      { backgroundColor: c.cardAlt, borderColor: c.border },
                    ]}
                    accessibilityLabel={`Fantasy points: ${formatScore(starterTotal)}`}
                  >
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.headerPillLabel, { color: c.gold }]}
                    >
                      FPTS
                    </ThemedText>
                    <ThemedText
                      type="mono"
                      style={[styles.headerPillValue, { color: c.text }]}
                    >
                      {formatScore(starterTotal)}
                    </ThemedText>
                  </View>
                )}
              </>
            }
          />
          <View
            style={[
              styles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {starterSlots.map((slot, idx) =>
              renderSlotRow(slot, idx, starterSlots),
            )}
          </View>
        </View>

        {/* Bench */}
        <View style={styles.section}>
          <SectionEyebrow label="BENCH" />
          <View
            style={[
              styles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {benchSlots.length > 0 ? (
              benchSlots.map((slot, idx) =>
                renderSlotRow(slot, idx, benchSlots),
              )
            ) : (
              <View style={styles.emptyBench}>
                <ThemedText
                  type="varsitySmall"
                  style={{ color: c.secondaryText, letterSpacing: 1.2 }}
                >
                  NO BENCH SLOTS
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* IR */}
        {irSlots.length > 0 && (
          <View style={styles.section}>
            <SectionEyebrow label="INJURED RESERVE" />
            <View
              style={[
                styles.card,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
            </View>
          </View>
        )}

        {/* Taxi Squad */}
        {taxiSlots.length > 0 && (
          <View style={styles.section}>
            <SectionEyebrow label="TAXI SQUAD" />
            <View
              style={[
                styles.card,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              {taxiSlots.map((slot, idx) =>
                renderSlotRow(slot, idx, taxiSlots),
              )}
            </View>
          </View>
        )}
        </View>

        {/* Draft Picks — outside the share capture, below Taxi */}
        <MyPicksSection
          teamId={teamId}
          leagueId={leagueId}
          isDynasty={(league?.league_type ?? "dynasty") === "dynasty"}
        />
      </ScrollView>
        </View>
      </GestureDetector>

      {/* First-visit coach mark for changing lineup slots */}
      <InfoModal
        visible={showMoveHint}
        onClose={dismissMoveHint}
        title="Changing lineup slots"
        message="Tap the position label (PG, SG, UTIL, BE, etc.) — or long-press a player — to open the move menu. From there you can swap slots, bench a starter, activate from IR, or move someone to the taxi squad. Tapping the player itself opens their details."
      />

      {currentWeek && (
        <RosterDayPicker
          visible={showDayPicker}
          onClose={() => setShowDayPicker(false)}
          weekStart={currentWeek.start_date}
          weekEnd={currentWeek.end_date}
          weekNumber={currentWeek.week_number}
          isPlayoff={currentWeek.is_playoff}
          selectedDate={selectedDate}
          today={today}
          earliestDate={rosterStartDate ?? null}
          onSelectDate={(d) => setSelectedDate(d)}
        />
      )}

      {currentWeek && scoringWeights && (
        <WeekSummarySheet
          visible={showWeekSummary}
          onClose={() => setShowWeekSummary(false)}
          weekLabel={`${currentWeek.is_playoff ? "Playoffs · " : ""}Week ${currentWeek.week_number}`}
          teams={[
            {
              teamName: heroMatchup?.me?.name ?? "My Team",
              tricode: heroMatchup?.me?.tricode ?? null,
              players: weekSummary
                ? [...weekSummary.players, ...weekSummary.droppedPlayers]
                : [],
            },
          ]}
          scoring={scoringWeights}
          isCategories={isCategories}
          sport={sport}
          liveMap={weekIsLive ? heroLiveMap : undefined}
          loading={weekSummaryFetching && !weekSummary}
        />
      )}

      {/* Slot Picker Modal */}
      {!isPastDate && (
        <SlotPickerModal
          visible={!!activeSlot}
          sourceSlot={activeSlot}
          destinations={activeSlot ? getEligibleDestinations() : []}
          quickActions={activeSlot ? getQuickActions() : []}
          eligiblePlayers={activeSlot ? getEligibleFillPlayers() : []}
          daySchedule={daySchedule}
          scoringWeights={scoringWeights}
          isCategories={isCategories}
          isAssigning={isAssigning}
          deferredToTomorrow={
            !!activeSlot?.player && isPlayerLocked(activeSlot.player)
          }
          onSelectDestination={(dest) => {
            if (!activeSlot?.player) return;
            handleRosterMove(
              activeSlot.player,
              activeSlot.slotPosition,
              dest.slot.slotPosition,
              dest.slot.player,
            );
          }}
          onSelectPlayer={(player) => {
            if (!activeSlot) return;
            // Fill mode: move the selected player into activeSlot
            handleRosterMove(
              player,
              player.roster_slot ?? "BE",
              activeSlot.slotPosition,
              activeSlot.player,
            );
          }}
          onQuickAction={(action) => {
            if (!activeSlot?.player) return;
            const player = activeSlot.player;
            const src = activeSlot.slotPosition;
            if (action === "activate") {
              // Check if active roster is full before activating from IR
              const activeCount = rosterPlayers?.filter(
                (p) => p.roster_slot !== "IR" && p.roster_slot !== ROSTER_SLOT.TAXI,
              ).length ?? 0;
              const maxActive = league?.roster_size ?? 13;
              if (activeCount >= maxActive) {
                // Open drop picker directly via PlayerDetailModal
                setActiveSlot(null);
                setActivateFromIRPlayer(true);
                setSelectedPlayer(player);
                return;
              }
              handleRosterMove(player, src, "BE", null);
            } else if (action === "bench" || action === "promote") {
              handleRosterMove(player, src, "BE", null);
            } else if (action === "ir") {
              const irSlot = irSlots.find((s) => !s.player) ?? irSlots[0];
              if (irSlot) {
                handleRosterMove(
                  player,
                  src,
                  "IR",
                  irSlot.player,
                );
              }
            } else if (action === "taxi") {
              const taxiSlot =
                taxiSlots.find((s) => !s.player) ?? taxiSlots[0];
              if (taxiSlot) {
                handleRosterMove(
                  player,
                  src,
                  ROSTER_SLOT.TAXI,
                  taxiSlot.player,
                );
              }
            }
          }}
          onClose={() => setActiveSlot(null)}
        />
      )}

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ""}
        teamId={teamId ?? undefined}
        startInActivateFromIR={activateFromIRPlayer}
        onClose={() => { setSelectedPlayer(null); setActivateFromIRPlayer(false); }}
        onRosterChange={() => {
          // Eagerly prefetch adjacent days so dropped/added players
          // don't flash briefly when navigating (same pattern as IR moves)
          if (!teamId || !leagueId) return;
          for (const day of [
            addDays(selectedDate, 1),
            addDays(selectedDate, 2),
          ]) {
            queryClient.prefetchQuery({
              queryKey: queryKeys.teamRoster(teamId, day),
              queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day, sport),
              staleTime: 1000 * 60 * 2,
            });
          }
        }}
      />

      {scoringWeights && fptsBreakdown && (
        <FptsBreakdownModal
          visible
          onClose={() => setFptsBreakdown(null)}
          playerName={fptsBreakdown.playerName}
          gameLabel={fptsBreakdown.gameLabel}
          gameStats={fptsBreakdown.stats}
          scoringWeights={scoringWeights}
        />
      )}

    </SafeAreaView>
  );
}

