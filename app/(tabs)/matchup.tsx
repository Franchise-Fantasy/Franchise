import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MatchupBoard } from "@/components/matchup/MatchupBoard";
import {
  buildMatchupSlots,
  computeLiveCategoryResults,
  fetchAllWeekMatchups,
  fetchMatchupDataById,
  fetchTeamSeeds,
  fetchWeeklyAdds,
  fetchWeekMatchupData,
  formatWeekRange,
  useWeekMatchup,
  useWeeks,
} from "@/components/matchup/matchupData";
import { MatchupHero } from "@/components/matchup/MatchupHero";
import { MatchupPillBar } from "@/components/matchup/MatchupPillBar";
import {
  MatchupBoardSkeleton,
  MatchupPillBarSkeleton,
} from "@/components/matchup/MatchupSkeleton";
import { styles } from "@/components/matchup/matchupStyles";
import { MatchupTicker } from "@/components/matchup/MatchupTicker";
import {
  DisplayMode,
  RosterPlayer,
  round1,
} from "@/components/matchup/PlayerCell";
import { RecapTicker } from "@/components/matchup/RecapTicker";
import { ScheduleTicker } from "@/components/matchup/ScheduleTicker";
import { WeekScheduleModal } from "@/components/matchup/WeekScheduleModal";
import { WeekSummarySheet } from "@/components/matchup/WeekSummarySheet";
import { FptsBreakdownModal } from "@/components/player/FptsBreakdownModal";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { ErrorState } from "@/components/ui/ErrorState";
import { InfoModal } from "@/components/ui/InfoModal";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { Colors } from "@/constants/Colors";
import { CURRENT_NBA_SEASON } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeague } from "@/hooks/useLeague";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLiveActivity } from "@/hooks/useLiveActivity";
import { useMatchupTickerEvents } from "@/hooks/useMatchupTickerEvents";
import { useRosterChanges } from "@/hooks/useRosterChanges";
import { useWeekScores } from "@/hooks/useWeekScores";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import {
  addDays,
  formatDayLabel,
  formatShortDate,
  useToday,
} from "@/utils/dates";
import {
  categoryResultsToLines,
  formatTopCategory,
  rankCategories,
} from "@/utils/liveActivity/contentState";
import {
  cleanupLiveActivityLogos,
  prepareLogosForLiveActivity,
} from "@/utils/liveActivity/prepareLogos";
import {
  LivePlayerStats,
  liveToGameLog,
  useLivePlayerStats,
} from "@/utils/nba/nbaLive";
import { fetchNbaScheduleForDate } from "@/utils/nba/nbaSchedule";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import { calculateGameFantasyPoints } from "@/utils/scoring/fantasyPoints";

// Slots whose points don't count toward the matchup score — excluded from
// every ticker (live recap, upcoming games, past recap).
const NON_SCORING_SLOTS = ["BE", "IR", ROSTER_SLOT.DROPPED, ROSTER_SLOT.TAXI] as const;

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MatchupScreen() {
  const { leagueId, teamId } = useAppState();
  const sport = useActiveLeagueSport();
  const router = useRouter();
  const { matchupId: paramMatchupId, promptLiveActivity: paramPromptLiveActivity } =
    useLocalSearchParams<{ matchupId?: string; promptLiveActivity?: string }>();
  const [highlightGoLive, setHighlightGoLive] = useState(false);
  const consumedPromptRef = useRef(false);

  useEffect(() => {
    if (consumedPromptRef.current) return;
    if (paramPromptLiveActivity !== "true") return;
    consumedPromptRef.current = true;
    setHighlightGoLive(true);
    router.setParams({ promptLiveActivity: undefined });
    const t = setTimeout(() => setHighlightGoLive(false), 6000);
    return () => clearTimeout(t);
  }, [paramPromptLiveActivity, router]);
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  const queryClient = useQueryClient();
  const { data: weeks, isLoading: weeksLoading } = useWeeks(leagueId);
  const { data: league } = useLeague();
  const { data: scoring } = useLeagueScoring(leagueId ?? "");
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? "");
  useRosterChanges(leagueId);

  const today = useToday();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [acqInfoVisible, setAcqInfoVisible] = useState(false);
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [selectedMatchupId, setSelectedMatchupId] = useState<string | null>(
    null,
  );
  const [pillTransitioning, setPillTransitioning] = useState(false);
  const [fptsBreakdown, setFptsBreakdown] = useState<{
    stats: Record<string, number | boolean>;
    playerName: string;
    gameLabel: string;
  } | null>(null);
  const [weeklySummaryVisible, setWeeklySummaryVisible] = useState(false);

  // Live Activity (Dynamic Island)
  const session = useSession();
  const {
    isSupported: liveActivitySupported,
    startMatchupActivity,
    endActivity,
  } = useLiveActivity(session?.user?.id);
  const [liveActivityId, setLiveActivityId] = useState<string | null>(null);

  const handlePlayerPress = async (playerId: string) => {
    // Cached so repeat taps on the same player serve from React Query
    const data = await queryClient.fetchQuery({
      queryKey: queryKeys.playerSeasonStat(playerId, sport),
      queryFn: async () => {
        const { data } = await supabase
          .from("player_season_stats")
          .select("*")
          .eq("player_id", playerId)
          .eq("sport", sport)
          .maybeSingle();
        return data as PlayerSeasonStats | null;
      },
      staleTime: 1000 * 60 * 5,
    });
    if (data) setSelectedPlayer(data);
  };

  const handleGoLive = async () => {
    if (!displayData || !teamId || !leagueId || !currentWeek || !isViewingOwnMatchup) return;

    // Toggle off if already active
    if (liveActivityId) {
      await endActivity(liveActivityId);
      setLiveActivityId(null);
      const opponentTeamId = displayData.rightTeam?.teamId;
      cleanupLiveActivityLogos(
        opponentTeamId ? [teamId, opponentTeamId] : [teamId],
      );
      return;
    }

    const fallbackTricode = (name: string) => name.substring(0, 3).toUpperCase();
    const myTricode =
      displayData.leftTeam.tricode?.trim() ||
      fallbackTricode(displayData.leftTeam.teamName);
    const opponentTricode = displayData.rightTeam
      ? displayData.rightTeam.tricode?.trim() ||
        fallbackTricode(displayData.rightTeam.teamName)
      : "BYE";

    const isCats = league?.scoring_type === "h2h_categories";

    let initialState;
    if (isCats && heroCategoryResult) {
      const inverseByStat: Record<string, boolean> = {};
      for (const s of scoring ?? []) inverseByStat[s.stat_name] = !!s.inverse;
      const lines = categoryResultsToLines(
        heroCategoryResult.results,
        "home",
        inverseByStat,
      );
      const ranked = rankCategories(lines);
      const myWins = heroCategoryResult.homeWins;
      const oppWins = heroCategoryResult.awayWins;
      initialState = {
        myScore: myWins,
        opponentScore: oppWins,
        scoreGap: myWins - oppWins,
        biggestContributor: formatTopCategory(ranked),
        myActivePlayers: 0,
        opponentActivePlayers: 0,
        players: [],
        categories: ranked,
        catTies: heroCategoryResult.ties,
      };
    } else {
      const leftScore = weekScores?.[displayData.leftTeam.teamId] ?? displayData.leftTeam.weekTotal;
      const rightScore = displayData.rightTeam
        ? (weekScores?.[displayData.rightTeam.teamId] ?? displayData.rightTeam.weekTotal)
        : 0;
      initialState = {
        myScore: leftScore,
        opponentScore: rightScore,
        scoreGap: leftScore - rightScore,
        biggestContributor: "",
        myActivePlayers: 0,
        opponentActivePlayers: 0,
        players: [],
      };
    }

    const opponentTeamId = displayData.rightTeam?.teamId ?? "";
    const { myLogoFileUri, opponentLogoFileUri } = await prepareLogosForLiveActivity({
      myTeamId: teamId,
      opponentTeamId,
      myLogoUrl: displayData.leftTeam.logoKey,
      opponentLogoUrl: displayData.rightTeam?.logoKey,
    });

    const result = await startMatchupActivity({
      mode: isCats ? "categories" : "points",
      myTeamName: displayData.leftTeam.teamName,
      opponentTeamName: displayData.rightTeam?.teamName ?? "BYE",
      myTeamTricode: myTricode,
      opponentTeamTricode: opponentTricode,
      matchupId: userMatchupId!,
      leagueId,
      scheduleId: currentWeek.id,
      teamId,
      opponentTeamId,
      myLogoFileUri,
      opponentLogoFileUri,
      initialState,
    });

    if (result) setLiveActivityId(result.activityId);
  };

  // Reset to today when switching leagues so stale data doesn't linger
  const prevLeague = useRef(leagueId);
  useEffect(() => {
    if (leagueId !== prevLeague.current) {
      setSelectedDate(today);
      setSelectedMatchupId(null);
      prevLeague.current = leagueId;
    }
  }, [leagueId]);

  // If the calendar date rolled over (e.g. app resumed from background after midnight), snap to today
  const prevToday = useRef(today);
  useEffect(() => {
    if (today !== prevToday.current) {
      if (selectedDate === prevToday.current) setSelectedDate(today);
      prevToday.current = today;
    }
  }, [today]);

  const minDate = weeks?.[0]?.start_date ?? today;
  const maxDate = weeks?.[weeks.length - 1]?.end_date ?? today;

  const currentWeek =
    weeks?.find(
      (w) => w.start_date <= selectedDate && selectedDate <= w.end_date,
    ) ?? null;

  // Schedule exists but the selected day is before tip-off (the draft-day gap
  // before opening night) — flips the hero from "OFFSEASON" to "UPCOMING".
  const firstWeekStart = weeks?.[0]?.start_date ?? null;
  const seasonOpensLabel =
    !currentWeek && firstWeekStart && selectedDate < firstWeekStart
      ? formatShortDate(firstWeekStart)
      : undefined;

  // Fetch all matchups for the pill bar
  const { data: allMatchups } = useQuery({
    queryKey: queryKeys.weekAllMatchups(currentWeek?.id!),
    queryFn: () => fetchAllWeekMatchups(currentWeek!.id),
    enabled: !!currentWeek,
    staleTime: 1000 * 60 * 5,
  });

  // Derive team names from already-fetched league data (avoids extra query)
  const teamNames = useMemo(() => {
    if (!league?.league_teams) return undefined;
    const map: Record<string, string> = {};
    for (const t of league.league_teams) map[t.id] = t.name;
    return map;
  }, [league?.league_teams]);

  // Tricode lookup for the pill bar — denser than full names and matches
  // how the hero displays the matched-up teams.
  const teamTricodes = useMemo(() => {
    if (!league?.league_teams) return undefined;
    const map: Record<string, string | null> = {};
    for (const t of league.league_teams) map[t.id] = t.tricode ?? null;
    return map;
  }, [league?.league_teams]);

  // Find the user's own matchup ID
  const userMatchupId =
    allMatchups?.find(
      (m) => m.home_team_id === teamId || m.away_team_id === teamId,
    )?.id ?? null;

  // Ordered matchup list for swipe nav. Matches the pill bar order
  // (user's matchup first, rest in natural order) so a left/right
  // swipe walks the same sequence the user sees in the pills above.
  const orderedMatchupIds = useMemo(() => {
    if (!allMatchups) return [] as string[];
    return [...allMatchups]
      .sort((a, b) => {
        const aMine =
          a.home_team_id === teamId || a.away_team_id === teamId;
        const bMine =
          b.home_team_id === teamId || b.away_team_id === teamId;
        if (aMine && !bMine) return -1;
        if (!aMine && bMine) return 1;
        return 0;
      })
      .map((m) => m.id);
  }, [allMatchups, teamId]);

  const matchupIndex = selectedMatchupId
    ? orderedMatchupIds.indexOf(selectedMatchupId)
    : -1;
  // Wraps at the ends so the carousel feels continuous (deck of cards).
  const prevMatchupId =
    orderedMatchupIds.length > 1 && matchupIndex >= 0
      ? orderedMatchupIds[
          (matchupIndex - 1 + orderedMatchupIds.length) %
            orderedMatchupIds.length
        ]
      : null;
  const nextMatchupId =
    orderedMatchupIds.length > 1 && matchupIndex >= 0
      ? orderedMatchupIds[(matchupIndex + 1) % orderedMatchupIds.length]
      : null;

  // Single validation pass: if the current selection isn't in this week's
  // matchups (week changed, or first load), fall back to the user's own
  // matchup, else the first available. Tolerates the deep-link write below
  // because the param's matchup IS in allMatchups for its week.
  useEffect(() => {
    if (!allMatchups) return;
    if (selectedMatchupId && allMatchups.some((m) => m.id === selectedMatchupId)) return;
    setSelectedMatchupId(userMatchupId ?? allMatchups[0]?.id ?? null);
  }, [allMatchups, userMatchupId, selectedMatchupId]);

  // Deep-link via `?matchupId=…` from scoreboard / schedule / bracket / result
  // modal. Look up which schedule week the matchup belongs to, jump
  // selectedDate into that week (clamping today to the week range to mirror
  // the prior matchup-detail behavior), then set the selection. The param
  // is cleared after consumption so future in-tab navigation isn't sticky.
  const consumedParamRef = useRef<string | null>(null);
  const { data: paramMatchupWeek } = useQuery({
    queryKey: ["matchupParamWeek", paramMatchupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_matchups")
        .select("schedule_id, league_schedule!inner(start_date, end_date)")
        .eq("id", paramMatchupId!)
        .single();
      if (error) throw error;
      return data as unknown as {
        schedule_id: string;
        league_schedule: { start_date: string; end_date: string };
      };
    },
    enabled: !!paramMatchupId && consumedParamRef.current !== paramMatchupId,
    staleTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (!paramMatchupId) return;
    if (consumedParamRef.current === paramMatchupId) return;
    if (!paramMatchupWeek) return;
    const { start_date, end_date } = paramMatchupWeek.league_schedule;
    const targetDate =
      today < start_date ? start_date : today > end_date ? end_date : today;
    setSelectedDate(targetDate);
    setSelectedMatchupId(paramMatchupId);
    consumedParamRef.current = paramMatchupId;
    router.setParams({ matchupId: undefined });
  }, [paramMatchupId, paramMatchupWeek, today, router]);

  const isViewingOwnMatchup = selectedMatchupId === userMatchupId;

  const {
    data: matchupData,
    isLoading: matchupLoading,
    isError: matchupError,
    refetch: refetchMatchup,
  } = useWeekMatchup(weeks, selectedDate, teamId, leagueId, scoring ?? [], sport);

  // Fetch non-user matchup data when viewing another matchup
  const { data: otherMatchupData, isLoading: otherMatchupLoading } = useQuery({
    queryKey: queryKeys.matchupById(selectedMatchupId!, selectedDate),
    queryFn: () => {
      if (!selectedMatchupId || !currentWeek || !leagueId || !scoring)
        return null;
      return fetchMatchupDataById(
        selectedMatchupId,
        currentWeek,
        leagueId,
        selectedDate,
        scoring,
        sport,
      );
    },
    enabled:
      !isViewingOwnMatchup &&
      !!selectedMatchupId &&
      !!currentWeek &&
      !!leagueId &&
      !!scoring &&
      scoring.length > 0,
    staleTime: 1000 * 60 * 2,
    // Keep the previous day's data on screen while the new fetch is in
    // flight, so day switches don't flash "no matchup for this date" or
    // shift the score block layout. The pill-switch case (different
    // matchup) is masked by the existing `pillTransitioning` spinner,
    // so it's safe to use the unconditional helper here.
    placeholderData: keepPreviousData,
  });

  // Unified display data
  const displayData = isViewingOwnMatchup
    ? matchupData
      ? { leftTeam: matchupData.myTeam, rightTeam: matchupData.opponentTeam }
      : null
    : otherMatchupData
      ? {
          leftTeam: otherMatchupData.homeTeam,
          rightTeam: otherMatchupData.awayTeam,
        }
      : null;
  const displayLoading =
    pillTransitioning ||
    (isViewingOwnMatchup ? matchupLoading : otherMatchupLoading);

  // First-load gate. True until we have real matchup data to show AND the
  // boot queries (weeks → scoring → matchup list → matchup data) are still
  // settling. Drives the hero, pill-bar, and board skeletons so the full
  // layout is reserved from the first frame — no spinner→chrome jump. Note
  // that a disabled React Query (e.g. matchup query before scoring loads)
  // reports `isLoading: false`, so we OR in the upstream conditions
  // explicitly rather than leaning on `displayLoading` alone.
  const coldLoading =
    !displayData &&
    (weeksLoading ||
      !scoring ||
      scoring.length === 0 ||
      displayLoading ||
      (!!currentWeek && allMatchups === undefined));

  // Parallel "today" fetch for the hero week score. The hero score is
  // week-wide and must not change when the user swipes the day picker —
  // but `displayData` is keyed on `selectedDate`, so its `weekTotal` and
  // `players` (used for liveBonus) drift across days. We mirror the same
  // matchup query with selectedDate=today so the hero always reads from
  // today's roster + today's weekTotal regardless of which day is shown.
  // When the user IS on today, the query keys match and React Query
  // dedupes — no extra network request.
  // Only meaningful for the current live week; outside it the hero falls
  // back to displayData (finalized stored scores or future placeholders).
  const isLiveWeekView =
    !!currentWeek &&
    currentWeek.start_date <= today &&
    today <= currentWeek.end_date;
  const { data: todayMatchupData } = useQuery({
    queryKey: queryKeys.weekMatchup(
      leagueId!,
      currentWeek?.id,
      teamId ?? undefined,
      today,
    ),
    queryFn: () => {
      if (!currentWeek || !teamId || !leagueId || !scoring) return null;
      return fetchWeekMatchupData(currentWeek, teamId, leagueId, today, scoring, sport);
    },
    enabled:
      isLiveWeekView &&
      isViewingOwnMatchup &&
      !!teamId &&
      !!leagueId &&
      !!scoring &&
      scoring.length > 0,
    staleTime: 1000 * 60 * 2,
  });
  const { data: todayOtherMatchupData } = useQuery({
    queryKey: queryKeys.matchupById(selectedMatchupId!, today),
    queryFn: () => {
      if (!selectedMatchupId || !currentWeek || !leagueId || !scoring)
        return null;
      return fetchMatchupDataById(
        selectedMatchupId,
        currentWeek,
        leagueId,
        today,
        scoring,
        sport,
      );
    },
    enabled:
      isLiveWeekView &&
      !isViewingOwnMatchup &&
      !!selectedMatchupId &&
      !!leagueId &&
      !!scoring &&
      scoring.length > 0,
    staleTime: 1000 * 60 * 2,
  });
  const todayDisplayData = isViewingOwnMatchup
    ? todayMatchupData
      ? {
          leftTeam: todayMatchupData.myTeam,
          rightTeam: todayMatchupData.opponentTeam,
        }
      : null
    : todayOtherMatchupData
      ? {
          leftTeam: todayOtherMatchupData.homeTeam,
          rightTeam: todayOtherMatchupData.awayTeam,
        }
      : null;

  // Collect player IDs from both teams. `allPlayerIds` feeds the live stat
  // subscription — it's the union of the displayed matchup and the
  // today-keyed matchup so today's roster stays subscribed even while the
  // user browses a past day of the live week. The hero week score and the
  // weekly summary both need today's live data regardless of which day the
  // picker shows. `tickerPlayerIds` is narrowed to active starting slots
  // only — bench/IR/dropped points don't contribute to the matchup score,
  // so their plays don't belong on the recap tape.
  const allPlayerIds: string[] = [
    ...new Set(
      [
        ...(displayData?.leftTeam.players ?? []),
        ...(displayData?.rightTeam?.players ?? []),
        ...(todayDisplayData?.leftTeam.players ?? []),
        ...(todayDisplayData?.rightTeam?.players ?? []),
      ].map((p) => p.player_id),
    ),
  ];
  const tickerPlayerIds: string[] = displayData
    ? [
        ...displayData.leftTeam.players
          .filter((p) => !(NON_SCORING_SLOTS as readonly string[]).includes(p.roster_slot))
          .map((p) => p.player_id),
        ...(displayData.rightTeam?.players
          .filter((p) => !(NON_SCORING_SLOTS as readonly string[]).includes(p.roster_slot))
          .map((p) => p.player_id) ?? []),
      ]
    : [];

  // Active starters for both sides — the recap (past) and upcoming-games
  // (future) tickers crawl these. Same non-scoring-slot filter as the live
  // tape so bench/IR/dropped players never appear on any ticker.
  const tickerStarters: RosterPlayer[] = useMemo(() => {
    if (!displayData) return [];
    const starters = (ps: RosterPlayer[]) =>
      ps.filter((p) => !(NON_SCORING_SLOTS as readonly string[]).includes(p.roster_slot));
    return [
      ...starters(displayData.leftTeam.players),
      ...starters(displayData.rightTeam?.players ?? []),
    ];
  }, [displayData]);

  const isToday = selectedDate === today;
  const yesterday = addDays(today, -1);
  const isYesterday = selectedDate === yesterday;
  const weekIsLive = !!currentWeek && currentWeek.start_date <= today && today <= currentWeek.end_date;
  // Live stats — kept subscribed across the whole live week (not just
  // today/yesterday) so the hero week score and the weekly summary always
  // have today's live data, even while the user browses a past day. Live
  // data itself only ever covers today + yesterday (see useLivePlayerStats);
  // per-day cells filter to `selectedDate` via `liveMap` below.
  const rawLiveMap = useLivePlayerStats(
    allPlayerIds,
    weekIsLive || isToday || isYesterday,
  );

  // Recap ticker events. Hook subscribes to global live_scoring_events
  // inserts and filters to the matchup's active-slot players client-side
  // (postgres_changes filters can't fit 20+ UUIDs). Multiple events per
  // player are intentionally allowed — dedupe is keyed on event id, not
  // player id, so a player who has 3 plays gets all 3 chips on the tape.
  const { events: tickerEvents } = useMatchupTickerEvents(
    tickerPlayerIds,
    weekIsLive && (isToday || isYesterday),
  );

  // "Has any game tipped off today?" — used to keep yesterday's recap
  // visible until today's first game starts, then swap. One cheap row
  // count against live_player_stats; refetched once a minute while the
  // week is live.
  const { data: todayHasLiveGames } = useQuery({
    queryKey: ["todayHasLiveGames", today, sport],
    queryFn: async () => {
      const { count } = await supabase
        .from("live_player_stats")
        .select("id", { count: "exact", head: true })
        .eq("game_date", today)
        .eq("sport", sport)
        .gte("game_status", 2);
      return (count ?? 0) > 0;
    },
    enabled: weekIsLive,
    refetchInterval: weekIsLive ? 60_000 : false,
    staleTime: 30_000,
  });

  // Filter live stats to only include games matching the selected date.
  // Yesterday's late games (still live past midnight) show on yesterday's view,
  // not today's.
  // For past dates, exclude final games (status 3) — those are already counted
  // in dayTotal from player_games. Only keep still-live games to avoid doubling.
  const liveMap = useMemo(
    () =>
      new Map(
        [...rawLiveMap].filter(([, stats]) => {
          if (stats.game_date !== selectedDate) return false;
          if (stats.game_date < today && stats.game_status === 3) return false;
          return true;
        }),
      ),
    [rawLiveMap, selectedDate, today],
  );

  // Hero-bonus map: includes today's games (live or final — not yet in
  // player_games because the today-fetch query stops at today-1) plus
  // yesterday's still-live games (haven't been finalized yet). EXCLUDES
  // yesterday's status=3 finals, which are already rolled into
  // heroData.weekTotal via player_games — adding them again here
  // double-counts (e.g. a player whose team didn't play today shows
  // their yesterday-final fpts twice). Shared by the hero week score and
  // the weekly summary modal so the two always agree.
  const heroLiveMap = useMemo(
    () =>
      new Map(
        [...rawLiveMap].filter(
          ([, stats]) => !(stats.game_date < today && stats.game_status === 3),
        ),
      ),
    [rawLiveMap, today],
  );

  // Server-authoritative week scores (single source of truth)
  const { data: weekScores } = useWeekScores({
    leagueId,
    scheduleId: currentWeek?.id ?? null,
    weekIsLive,
  });

  // Clear pill transition after live stats have re-settled for the new player set.
  // Uses a short delay to let useLivePlayerStats unsubscribe/resubscribe without
  // flashing the score without live bonus.
  useEffect(() => {
    if (!pillTransitioning) return;
    if (!weekIsLive) {
      setPillTransitioning(false);
      return;
    }
    const timer = setTimeout(() => setPillTransitioning(false), 600);
    return () => clearTimeout(timer);
  }, [pillTransitioning, weekIsLive]);

  // Schedule for the selected date: tricode → { matchup, tipoff, final score }.
  // Fetched for every day state — future/today use it for the tipoff caption,
  // past days use the persisted final score (live stats expire).
  const { data: daySchedule } = useQuery<Map<string, any>>({
    queryKey: [...queryKeys.futureSchedule(selectedDate), sport],
    queryFn: () => fetchNbaScheduleForDate(selectedDate, sport),
    staleTime: 1000 * 60 * 60,
  });

  // Prefetch adjacent days to reduce pop-in when navigating
  useEffect(() => {
    if (!weeks || !teamId || !leagueId || !scoring || scoring.length === 0)
      return;
    const adjacent = [
      addDays(selectedDate, -1),
      addDays(selectedDate, 1),
      addDays(selectedDate, 2),
    ];

    for (const day of adjacent) {
      const wk = weeks.find((w) => w.start_date <= day && day <= w.end_date);
      if (!wk) continue;

      // User's own matchup
      queryClient.prefetchQuery({
        queryKey: queryKeys.weekMatchup(leagueId!, wk.id, teamId, day),
        queryFn: () => fetchWeekMatchupData(wk, teamId, leagueId, day, scoring, sport),
        staleTime: 1000 * 60 * 2,
      });

      // Currently-viewed matchup (when looking at someone else's) — without
      // this prefetch, swiping days while viewing another matchup hits a
      // cold cache and pops the score block.
      if (selectedMatchupId && !isViewingOwnMatchup) {
        queryClient.prefetchQuery({
          queryKey: queryKeys.matchupById(selectedMatchupId, day),
          queryFn: () =>
            fetchMatchupDataById(selectedMatchupId, wk, leagueId, day, scoring, sport),
          staleTime: 1000 * 60 * 2,
        });
      }

      queryClient.prefetchQuery({
        queryKey: [...queryKeys.futureSchedule(day), sport],
        queryFn: () => fetchNbaScheduleForDate(day, sport),
        staleTime: 1000 * 60 * 60,
      });
    }
  }, [selectedDate, weeks, teamId, leagueId, scoring, sport, selectedMatchupId, isViewingOwnMatchup]);

  const { data: seedMap } = useQuery({
    queryKey: queryKeys.matchupSeeds(leagueId!, currentWeek?.week_number!),
    queryFn: async () => {
      // Find the playoff round: query any matchup in this schedule week
      const { data: matchups } = await supabase
        .from("league_matchups")
        .select("playoff_round")
        .eq("schedule_id", currentWeek!.id)
        .not("playoff_round", "is", null)
        .limit(1);
      const round = matchups?.[0]?.playoff_round;
      if (!round) return new Map<string, number>();
      return fetchTeamSeeds(leagueId!, league?.season ?? CURRENT_NBA_SEASON, round);
    },
    enabled: !!leagueId && !!currentWeek?.is_playoff,
    staleTime: 1000 * 60 * 5,
  });

  // Weekly acquisition limit — ACQ band under the score block shows
  // both teams' usage so users can compare opponents at a glance.
  const weeklyLimit = (league?.weekly_acquisition_limit as number | null) ?? null;
  const leftTeamId = displayData?.leftTeam.teamId ?? null;
  const rightTeamId = displayData?.rightTeam?.teamId ?? null;

  const { data: leftAdds } = useQuery({
    queryKey: queryKeys.weeklyAddsForWeek(
      leagueId!,
      leftTeamId!,
      currentWeek?.id ?? "",
    ),
    queryFn: () =>
      fetchWeeklyAdds(
        leagueId!,
        leftTeamId!,
        currentWeek!.start_date,
        currentWeek!.end_date,
      ),
    enabled:
      !!leagueId && !!leftTeamId && !!currentWeek && weeklyLimit != null,
    staleTime: 1000 * 60 * 2,
  });

  const { data: rightAdds } = useQuery({
    queryKey: queryKeys.weeklyAddsForWeek(
      leagueId!,
      rightTeamId!,
      currentWeek?.id ?? "",
    ),
    queryFn: () =>
      fetchWeeklyAdds(
        leagueId!,
        rightTeamId!,
        currentWeek!.start_date,
        currentWeek!.end_date,
      ),
    enabled:
      !!leagueId && !!rightTeamId && !!currentWeek && weeklyLimit != null,
    staleTime: 1000 * 60 * 2,
  });

  const mode: DisplayMode =
    selectedDate < today ? "past" : selectedDate === today ? "today" : "future";

  // Compute live FPTS bonus from a given stats map
  function computeLiveBonusFrom(
    players: RosterPlayer[],
    statsMap: Map<string, LivePlayerStats>,
  ): number {
    if (statsMap.size === 0) return 0;
    return round1(
      players.reduce((sum, p) => {
        if (
          p.roster_slot === "BE" ||
          p.roster_slot === "IR" ||
          p.roster_slot === ROSTER_SLOT.DROPPED
        )
          return sum;
        const live = statsMap.get(p.player_id);
        if (!live) return sum;
        return (
          sum +
          calculateGameFantasyPoints(liveToGameLog(live) as any, scoring ?? [])
        );
      }, 0),
    );
  }

  if (!leagueId) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>Join or create a league to see matchups.</ThemedText>
      </ThemedView>
    );
  }

  // Season-not-started copy only once the weeks query has actually settled —
  // while it's still loading we fall through to the skeleton chrome below so
  // the layout is reserved from the first frame.
  if (!weeksLoading && (!weeks || weeks.length === 0)) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="defaultSemiBold">Season not started yet.</ThemedText>
        <ThemedText
          style={{ color: c.secondaryText, marginTop: 6, textAlign: "center" }}
        >
          The schedule is generated automatically once the draft is complete.
        </ThemedText>
      </ThemedView>
    );
  }

  // Day-totals for the hero — always the actual day's points (past total
  // + any live bonus). Future days resolve to 0 naturally because there's
  // no past dayTotal and no live data, which the hero renders as
  // `0.00 TODAY` to match the same band on the current day.
  const heroLeftDayScore = displayData
    ? round1(
        displayData.leftTeam.dayTotal +
          computeLiveBonusFrom(displayData.leftTeam.players, liveMap),
      )
    : 0;
  const heroRightDayScore = displayData?.rightTeam
    ? round1(
        displayData.rightTeam.dayTotal +
          computeLiveBonusFrom(displayData.rightTeam.players, liveMap),
      )
    : 0;

  // Hero week score uses today's matchup data (when viewing the live
  // week) so it stays identical across day picker switches. Outside the
  // live week (past or future weeks) we fall back to the per-date
  // displayData — those weeks have no in-progress games, so weekTotal
  // alone is the full picture.
  const heroDataLeft = isLiveWeekView
    ? (todayDisplayData?.leftTeam ?? displayData?.leftTeam ?? null)
    : (displayData?.leftTeam ?? null);
  const heroDataRight = isLiveWeekView
    ? (todayDisplayData?.rightTeam ?? displayData?.rightTeam ?? null)
    : (displayData?.rightTeam ?? null);
  const heroLeftLiveBonus = heroDataLeft
    ? computeLiveBonusFrom(heroDataLeft.players, heroLiveMap)
    : 0;
  const heroRightLiveBonus = heroDataRight
    ? computeLiveBonusFrom(heroDataRight.players, heroLiveMap)
    : 0;

  const heroLeftTeam = displayData
    ? {
        teamId: displayData.leftTeam.teamId,
        teamName: displayData.leftTeam.teamName,
        tricode: displayData.leftTeam.tricode,
        logoKey: displayData.leftTeam.logoKey,
        wins: displayData.leftTeam.wins,
        losses: displayData.leftTeam.losses,
        ties: displayData.leftTeam.ties,
        // Take the higher of the two so the score never visibly dips
        // when one source updates a beat after the other (week_scores
        // realtime broadcast vs the matchup query refetch). Totals only
        // ever climb — the brief lower number was the stale half-state.
        // Include live bonus on the heroData side so the TOTAL ticks up
        // the moment a play lands, not 30s later when week_scores
        // catches up. heroDataLeft is today's data on a live week so
        // this value matches across day picker switches.
        weekScore: Math.max(
          weekScores?.[displayData.leftTeam.teamId] ?? 0,
          round1((heroDataLeft?.weekTotal ?? 0) + heroLeftLiveBonus),
        ),
        dayScore: heroLeftDayScore,
      }
    : null;
  const heroRightTeam = displayData?.rightTeam
    ? {
        teamId: displayData.rightTeam.teamId,
        teamName: displayData.rightTeam.teamName,
        tricode: displayData.rightTeam.tricode,
        logoKey: displayData.rightTeam.logoKey,
        wins: displayData.rightTeam.wins,
        losses: displayData.rightTeam.losses,
        ties: displayData.rightTeam.ties,
        weekScore: Math.max(
          weekScores?.[displayData.rightTeam.teamId] ?? 0,
          round1((heroDataRight?.weekTotal ?? 0) + heroRightLiveBonus),
        ),
        dayScore: heroRightDayScore,
      }
    : null;

  const heroIsCategories = league?.scoring_type === "h2h_categories";

  // Hero category tally — week-wide (today-keyed heroData + heroLiveMap), so
  // it stays fixed across day-picker switches just like the points week score.
  // Cheap to recompute each render (a handful of categories); the board does
  // the same per-day computation via the shared helper.
  const heroCategoryResult =
    heroIsCategories && heroDataLeft
      ? computeLiveCategoryResults(
          heroDataLeft,
          heroDataRight,
          scoring ?? [],
          heroLiveMap,
        )
      : null;
  const heroCategoryRecord = heroCategoryResult
    ? {
        leftWins: heroCategoryResult.homeWins,
        rightWins: heroCategoryResult.awayWins,
        ties: heroCategoryResult.ties,
      }
    : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <MatchupHero
        selectedDate={selectedDate}
        today={today}
        isPastDate={selectedDate < today}
        isToday={selectedDate === today}
        canGoBack={selectedDate > minDate}
        dayLabel={formatDayLabel(selectedDate)}
        currentWeek={currentWeek}
        seasonOpensLabel={seasonOpensLabel}
        weekIsLive={weekIsLive}
        leftTeam={heroLeftTeam}
        rightTeam={heroRightTeam}
        leftSeed={
          heroLeftTeam && seedMap?.has(heroLeftTeam.teamId)
            ? seedMap.get(heroLeftTeam.teamId)
            : undefined
        }
        rightSeed={
          heroRightTeam && seedMap?.has(heroRightTeam.teamId)
            ? seedMap.get(heroRightTeam.teamId)
            : undefined
        }
        isCategories={heroIsCategories}
        categoryRecord={heroCategoryRecord}
        weeklyLimit={weeklyLimit}
        leftAdds={leftAdds ?? undefined}
        rightAdds={rightAdds ?? undefined}
        isLoading={coldLoading}
        liveActivitySupported={
          liveActivitySupported && isViewingOwnMatchup && weekIsLive
        }
        liveActivityActive={!!liveActivityId}
        liveActivityHighlighted={highlightGoLive}
        onGoLive={handleGoLive}
        onPrevDay={() => {
          if (selectedDate > minDate)
            setSelectedDate(addDays(selectedDate, -1));
        }}
        onNextDay={() => {
          if (selectedDate < maxDate)
            setSelectedDate(addDays(selectedDate, 1));
        }}
        onPrevMatchup={
          prevMatchupId ? () => setSelectedMatchupId(prevMatchupId) : undefined
        }
        onNextMatchup={
          nextMatchupId ? () => setSelectedMatchupId(nextMatchupId) : undefined
        }
        onGoToToday={() => {
          // Today is a valid return target whenever it's not past the season's
          // end — that covers in-season days and the pre-tip-off gap (today
          // before the first week), which now renders the upcoming hero. Only a
          // genuinely finished season (today > last week) stays off-limits.
          if (today <= maxDate) setSelectedDate(today);
        }}
        onSchedulePress={() => setScheduleVisible(true)}
        onSummaryPress={
          heroDataLeft && currentWeek
            ? () => setWeeklySummaryVisible(true)
            : undefined
        }
        onAcqInfoPress={
          weeklyLimit != null ? () => setAcqInfoVisible(true) : undefined
        }
        onTeamPress={(id) => {
          if (id === teamId) router.push("/(tabs)/roster");
          else router.push(`/team-roster/${id}` as any);
        }}
        tickerSlot={
          // The band is always present (whenever we have a week + scoring) so
          // the hero chrome stays consistent across day swipes — but what it
          // crawls depends on the day: today = live recap events, past = a
          // top-performers recap from box scores, future = upcoming games.
          currentWeek && scoring && scoring.length > 0 ? (
            coldLoading ? (
              // Stay quiet during cold-load — the skeleton body reserves the
              // ticker height, so a blank tape reads as "still loading."
              <MatchupTicker events={[]} scoring={scoring} hideFpts={heroIsCategories} emptyText="" />
            ) : mode === "future" ? (
              <ScheduleTicker players={tickerStarters} schedule={daySchedule ?? new Map()} />
            ) : mode === "past" ? (
              <RecapTicker players={tickerStarters} hideFpts={heroIsCategories} />
            ) : (
              <MatchupTicker
                events={tickerEvents}
                scoring={scoring}
                hideFpts={heroIsCategories}
                emptyText={
                  todayHasLiveGames ? "WAITING FOR FIRST PLAY" : "NO GAMES STARTED YET"
                }
              />
            )
          ) : null
        }
      />

      {/* Matchup pill bar. During cold load the matchup list isn't known
          yet, so we reserve the bar's height with a skeleton — otherwise the
          real pills popping in shove the board below them downward. */}
      {allMatchups && allMatchups.length > 1 && teamNames ? (
        <MatchupPillBar
          allMatchups={allMatchups}
          teamNames={teamNames}
          teamTricodes={teamTricodes}
          teamId={teamId}
          selectedMatchupId={selectedMatchupId}
          onSelect={(id) => {
            setPillTransitioning(true);
            setSelectedMatchupId(id);
          }}
        />
      ) : coldLoading ? (
        <MatchupPillBarSkeleton />
      ) : null}

      {/* Matchup body — always rendered so the page reserves layout
          height. Order of precedence:
            1. Error state (only on the user's own matchup query failing)
            2. Real data (MatchupBoard)
            3. Skeleton (while loading — prevents flash of "no matchup" copy
               on cold load; reserved height keeps the page from jumping)
            4. Empty copy (only after queries have settled with no result) */}
      <ScrollView contentContainerStyle={styles.body}>
        {matchupError && isViewingOwnMatchup ? (
          <ErrorState
            message="Failed to load matchup"
            onRetry={() => refetchMatchup()}
          />
        ) : displayData ? (
          <MatchupBoard
            leftTeam={displayData.leftTeam}
            rightTeam={displayData.rightTeam}
            leftSlots={
              rosterConfig
                ? buildMatchupSlots(
                    displayData.leftTeam.players,
                    rosterConfig,
                  )
                : []
            }
            rightSlots={
              rosterConfig && displayData.rightTeam
                ? buildMatchupSlots(
                    displayData.rightTeam.players,
                    rosterConfig,
                  )
                : []
            }
            c={c}
            mode={mode}
            liveMap={liveMap}
            scoring={scoring ?? []}
            schedule={daySchedule}
            seedMap={seedMap ?? undefined}
            onPlayerPress={handlePlayerPress}
            onFptsPress={(stats, name, label) =>
              setFptsBreakdown({ stats, playerName: name, gameLabel: label })
            }
            scoringType={league?.scoring_type}
          />
        ) : coldLoading ? (
          <MatchupBoardSkeleton />
        ) : !currentWeek ? (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>
              No matchup for this date.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>
              {currentWeek.is_playoff
                ? "No matchup this playoff week."
                : "No matchup found for this week."}
            </ThemedText>
          </View>
        )}
      </ScrollView>

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ""}
        teamId={teamId ?? undefined}
        onClose={() => setSelectedPlayer(null)}
      />

      {scoring && fptsBreakdown && (
        <FptsBreakdownModal
          visible
          onClose={() => setFptsBreakdown(null)}
          playerName={fptsBreakdown.playerName}
          gameLabel={fptsBreakdown.gameLabel}
          gameStats={fptsBreakdown.stats}
          scoringWeights={scoring}
        />
      )}

      {scoring && heroDataLeft && currentWeek && (
        // Fed from heroData (the today-keyed, day-picker-independent fetch),
        // not the per-day displayData — so the summary total stays fixed as
        // the user clicks through days and matches the hero week score.
        <WeekSummarySheet
          visible={weeklySummaryVisible}
          onClose={() => setWeeklySummaryVisible(false)}
          weekLabel={`Week ${currentWeek.week_number} · ${formatWeekRange(currentWeek.start_date, currentWeek.end_date)}${currentWeek.is_double_week ? ' · Double Week' : ''}`}
          teams={[
            {
              teamName: heroDataLeft.teamName,
              tricode: heroDataLeft.tricode,
              players: [
                ...heroDataLeft.players,
                ...heroDataLeft.droppedPlayers,
              ],
            },
            ...(heroDataRight
              ? [
                  {
                    teamName: heroDataRight.teamName,
                    tricode: heroDataRight.tricode,
                    players: [
                      ...heroDataRight.players,
                      ...heroDataRight.droppedPlayers,
                    ],
                  },
                ]
              : []),
          ]}
          scoring={scoring}
          isCategories={heroIsCategories}
          sport={sport}
          liveMap={heroLiveMap}
        />
      )}

      <WeekScheduleModal
        visible={scheduleVisible}
        weeks={weeks ?? []}
        currentWeek={currentWeek}
        today={today}
        colors={{
          background: c.background,
          border: c.border,
          card: c.card,
          accent: c.accent,
          secondaryText: c.secondaryText,
        }}
        onClose={() => setScheduleVisible(false)}
        onSelectDate={setSelectedDate}
      />

      <InfoModal
        visible={acqInfoVisible}
        onClose={() => setAcqInfoVisible(false)}
        title="Weekly Acquisitions"
        message="Player pickups used this matchup week. Once the limit is reached, no more free agent adds are allowed until next week."
      />
    </SafeAreaView>
  );
}

