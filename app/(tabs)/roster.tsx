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

import { FptsBreakdownModal } from "@/components/player/FptsBreakdownModal";
import { MatchupChip } from "@/components/player/MatchupChip";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { AnimatedFpts } from "@/components/roster/AnimatedFpts";
import { IrLockBanner } from "@/components/roster/IrLockBanner";
import { MyPicksSection } from "@/components/roster/MyPicksSection";
import { RosterHero } from "@/components/roster/RosterHero";
import { rosterStyles as styles } from "@/components/roster/rosterStyles";
import { SectionEyebrow } from "@/components/roster/SectionEyebrow";
import {
  DestinationSlot,
  QuickAction,
  RosterPlayer,
  SlotEntry,
  SlotPickerModal,
} from "@/components/roster/SlotPickerModal";
import { useRosterShare } from "@/components/roster/useRosterShare";
import { ErrorState } from "@/components/ui/ErrorState";
import { InfoModal } from "@/components/ui/InfoModal";
import { type ModalAction } from "@/components/ui/InlineAction";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { getCurrentSeason, getPreviousSeason } from "@/constants/LeagueDefaults";
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
import { useRosterChanges } from "@/hooks/useRosterChanges";
import { useWeekScores } from "@/hooks/useWeekScores";
import { capture } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import type { PlayerGameLog } from "@/types/player";
import { addDays, formatDayLabel, useToday } from "@/utils/dates";
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
import { fetchTeamSlots } from "@/utils/roster/fetchTeamSlots";
import { isIrEligibleStatus } from "@/utils/roster/illegalIR";
import { isEligibleForSlot, slotLabel } from "@/utils/roster/rosterSlots";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import { isTaxiEligible } from "@/utils/roster/taxiEligibility";
import { buildCompositeScatter } from "@/utils/scoring/categoryAnalytics";
import {
  calculateAvgFantasyPoints,
  calculateGameFantasyPoints,
  formatScore,
} from "@/utils/scoring/fantasyPoints";


// ─── Types ───────────────────────────────────────────────────────────────────

// Per-player game stats fetched for a specific past date
interface DayGameStats {
  player_id: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  "3pm": number;
  "3pa": number;
  ftm: number;
  fta: number;
  pf: number;
  double_double: boolean;
  triple_double: boolean;
  matchup: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Compact stat line shown below player name: "20 PTS · 8 REB · 5 AST"
function buildStatLine(stats: Record<string, number>): string {
  const fields: [string, string][] = [
    ["pts", "PTS"],
    ["reb", "REB"],
    ["ast", "AST"],
  ];
  return fields
    .filter(([key]) => (stats[key] ?? 0) > 0)
    .map(([key, label]) => `${stats[key]} ${label}`)
    .join(" · ");
}

function dayToStatRecord(g: DayGameStats): Record<string, number | boolean> {
  return {
    pts: g.pts,
    reb: g.reb,
    ast: g.ast,
    stl: g.stl,
    blk: g.blk,
    tov: g.tov,
    fgm: g.fgm,
    fga: g.fga,
    "3pm": g["3pm"],
    "3pa": g["3pa"],
    ftm: g.ftm,
    fta: g.fta,
    pf: g.pf,
    double_double: g.double_double,
    triple_double: g.triple_double,
  };
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchTeamRosterForDate(
  teamId: string,
  leagueId: string,
  date: string,
  sport: string | null | undefined,
  weekBounds?: { start_date: string; end_date: string },
): Promise<RosterPlayer[]> {
  // Use the same slot resolution as the matchup page — guarantees parity
  const slots = await fetchTeamSlots(teamId, leagueId, date, weekBounds);

  const today = getSportToday(sport);
  const isPast = date < today;

  // Filter out players who weren't on the team on this date:
  // - DROPPED on this date (queued or completed drop) → hide, matching the
  //   matchup page filter in fetchTeamData
  // - If resolveSlot returns a real slot (from daily_lineups), the player was here — show them
  // - If resolveSlot returns 'BE' and acquired_at is after this date, they weren't here yet — hide
  // - This handles re-acquisitions correctly (Giannis: traded away/back, but daily_lineups proves
  //   presence on earlier dates even though acquired_at was overwritten by the trade)
  const currentForDate = [...slots.currentPlayerIds].filter((pid) => {
    const slot = slots.slotMap.get(pid);
    if (slot === ROSTER_SLOT.DROPPED) return false;
    if (slot && slot !== "BE") return true; // has a real slot assignment — was on team
    const acquired = slots.acquiredDateMap.get(pid);
    if (acquired && date < acquired) return false; // no slot + acquired after this date
    return true;
  });

  const droppedForDate = isPast
    ? slots.droppedPlayerIds.filter((pid) => {
        const slot = slots.slotMap.get(pid);
        return slot && slot !== ROSTER_SLOT.DROPPED; // only show if they had an active slot that day
      })
    : [];

  const allPlayerIds = [...currentForDate, ...droppedForDate];
  if (allPlayerIds.length === 0) return [];

  // Fetch season stats + player info in parallel
  const [statsResult, playersResult] = await Promise.all([
    supabase
      .from("player_season_stats")
      .select("*")
      .in("player_id", allPlayerIds),
    supabase
      .from("players")
      .select("id, name, position, pro_team, external_id_nba, status, draft_year")
      .in("id", allPlayerIds),
  ]);

  if (statsResult.error) throw statsResult.error;

  type PlayerInfo = NonNullable<typeof playersResult.data>[number];

  // Build player info map for fallback when player_season_stats is missing
  const playerInfoMap = new Map<string, PlayerInfo>();
  for (const p of playersResult.data ?? []) playerInfoMap.set(p.id, p);

  const nbaTricodeMap = new Map<string, string>(
    (playersResult.data ?? [])
      .filter(
        (p): p is PlayerInfo & { pro_team: string } =>
          !!p.pro_team && p.pro_team !== "Active" && p.pro_team !== "Inactive",
      )
      .map((p) => [p.id, p.pro_team]),
  );

  // Map season stats by player_id for fast lookup
  const statsById = new Map<string, PlayerSeasonStats>();
  for (const p of (statsResult.data as PlayerSeasonStats[]) ?? []) {
    statsById.set(p.player_id, p);
  }

  // Build the roster — every player in allPlayerIds must appear,
  // even if missing from player_season_stats (newly acquired players)
  return allPlayerIds.map((pid) => {
    const stats = statsById.get(pid);
    const info = playerInfoMap.get(pid);

    if (stats) {
      return {
        ...stats,
        // players.status is the canonical injury status (poll-injuries updates
        // it directly). player_season_stats.status is not kept in sync, so
        // prefer the fresh value here.
        status: info?.status ?? stats.status,
        roster_slot: slots.slotMap.get(pid) ?? null,
        nbaTricode: nbaTricodeMap.get(pid) ?? null,
        acquired_at: (() => {
          const acq = slots.acquiredDateMap.get(pid);
          // Return original ISO string from league_players if available
          return acq ?? null;
        })(),
      };
    }

    // Stub entry for players missing from player_season_stats
    return {
      player_id: pid,
      name: info?.name ?? "Unknown",
      position: info?.position ?? "—",
      pro_team: info?.pro_team ?? "—",
      status: info?.status ?? "active",
      external_id_nba: info?.external_id_nba ?? null,
      rookie: false,
      season_added: null,
      draft_year: info?.draft_year ?? null,
      birthdate: null,
      games_played: 0,
      total_pts: 0,
      total_reb: 0,
      total_ast: 0,
      total_stl: 0,
      total_blk: 0,
      total_tov: 0,
      total_fgm: 0,
      total_fga: 0,
      total_3pm: 0,
      total_3pa: 0,
      total_ftm: 0,
      total_fta: 0,
      total_pf: 0,
      total_dd: 0,
      total_td: 0,
      avg_min: 0,
      avg_pts: 0,
      avg_reb: 0,
      avg_ast: 0,
      avg_stl: 0,
      avg_blk: 0,
      avg_tov: 0,
      avg_fgm: 0,
      avg_fga: 0,
      avg_3pm: 0,
      avg_3pa: 0,
      avg_ftm: 0,
      avg_fta: 0,
      avg_pf: 0,
      roster_slot: slots.slotMap.get(pid) ?? null,
      nbaTricode: nbaTricodeMap.get(pid) ?? null,
      acquired_at: slots.acquiredDateMap.get(pid) ?? null,
    } as RosterPlayer;
  });
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RosterScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const sport = useActiveLeagueSport();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  useRosterChanges(leagueId);

  const today = useToday();
  const [selectedDate, setSelectedDate] = useState<string>(today);

  // If the calendar date rolled over (e.g. app resumed from background after midnight), snap to today
  const prevToday = useRef(today);
  useEffect(() => {
    if (today !== prevToday.current) {
      if (selectedDate === prevToday.current) setSelectedDate(today);
      prevToday.current = today;
    }
  }, [today]);

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
  const pickAction = useActionPicker();


  const isPastDate = selectedDate < today;
  const isFutureDate = selectedDate > today;
  const isToday = selectedDate === today;
  const yesterday = addDays(today, -1);
  const isYesterday = selectedDate === yesterday;

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? "");
  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === "h2h_categories";

  const { data: illegalIRPlayers } = useIllegalIR(leagueId, teamId);
  const irLocked = !!illegalIRPlayers && illegalIRPlayers.length > 0;
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId ?? "");

  // Current matchup week bounds (used to scope the Auto button + the hero
  // matchup-score lookup; `id` is the schedule_id used by useWeekScores).
  const { data: currentWeek } = useQuery({
    queryKey: queryKeys.currentMatchupWeek(leagueId!, today),
    queryFn: async () => {
      const { data } = await supabase
        .from("league_schedule")
        .select("id, start_date, end_date, week_number, is_playoff")
        .eq("league_id", leagueId!)
        .lte("start_date", today)
        .gte("end_date", today)
        .maybeSingle();
      return data as {
        id: string;
        start_date: string;
        end_date: string;
        week_number: number;
        is_playoff: boolean;
      } | null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 60,
  });

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
        return { me, opponent: null, isBye: false };
      }
      const { data: m } = await supabase
        .from("league_matchups")
        .select("home_team_id, away_team_id")
        .eq("schedule_id", currentWeek.id)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .maybeSingle();
      const opponentId = m
        ? m.home_team_id === teamId
          ? m.away_team_id
          : m.home_team_id
        : null;
      const ids = opponentId ? [teamId, opponentId] : [teamId];
      const { data: rows } = await supabase
        .from("teams")
        .select("id, tricode, name, wins, losses, ties")
        .in("id", ids);
      const me = rows?.find((t) => t.id === teamId) ?? null;
      const opp = opponentId
        ? rows?.find((t) => t.id === opponentId) ?? null
        : null;
      return { me, opponent: opp, isBye: !!m && !opponentId };
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

  // Schedule for today and future dates: tricode → matchup string
  const { data: daySchedule } = useQuery<Map<string, ScheduleEntry>>({
    queryKey: [...queryKeys.daySchedule(selectedDate), sport],
    queryFn: () => fetchNbaScheduleForDate(selectedDate, sport),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  // Live stats for today (and yesterday's still-live games that crossed midnight)
  const playerIds = rosterPlayers?.map((p) => p.player_id) ?? [];
  const rawLiveMap = useLivePlayerStats(playerIds, isToday || isYesterday);

  // Filter live stats to only include games matching the selected date.
  // Yesterday's late games (still live past midnight) show on yesterday's view,
  // not today's.
  const liveMap = new Map(
    [...rawLiveMap].filter(([, stats]) => stats.game_date === selectedDate),
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

  // Daily-context counts for the hero footer — starters playing on the
  // selected date, those whose games already started (today only), and
  // empty starter slots that need filling.
  let heroPlayCount = 0;
  let heroLockedCount = 0;
  let heroEmptyCount = 0;
  for (const slot of starterSlots) {
    if (!slot.player) {
      heroEmptyCount += 1;
      continue;
    }
    const tricode = slot.player.nbaTricode;
    if (tricode && daySchedule?.has(tricode)) {
      heroPlayCount += 1;
    }
    if (isToday && isPlayerLocked(slot.player)) {
      heroLockedCount += 1;
    }
  }

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
      isTaxiEligible(
        player.draft_year ?? null,
        league?.season ?? "",
        league?.taxi_max_experience ?? null,
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

      // TAXI: only bench players who are taxi-eligible
      if (isTaxi) {
        const isOnBench = !p.roster_slot || p.roster_slot === "BE";
        if (!isOnBench) return false;
        return isTaxiEligible(
          p.draft_year ?? null,
          league?.season ?? "",
          league?.taxi_max_experience ?? null,
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
            .update({ roster_slot: ROSTER_SLOT.TAXI })
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
        await runUpdate(
          supabase
            .from("league_players")
            .update({ roster_slot: destSlotPosition })
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
            "Game in progress — change takes effect tomorrow",
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
    pickAction({
      title: "Auto-Lineup",
      subtitle: "OPTIMIZE THE STARTING LINEUP",
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
      const playersNeedingFallback = rosterPlayers.filter(
        (p) => (p.games_played ?? 0) < MIN_CURRENT_SEASON_GAMES,
      );
      if (!isCategories && playersNeedingFallback.length > 0) {
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
          const fpts = calculateAvgFantasyPoints(
            h as unknown as PlayerSeasonStats,
            scoringWeights,
          );
          if (fpts > 0) prevSeasonFptsMap.set(h.player_id, fpts);
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

      // For CAT leagues, rank players by composite z-score instead of FPTS.
      // Shift all values so the minimum is at least 1, because the optimizer
      // treats 0 as "no game today" — negative z-scores would rank below
      // players with no game, breaking the lineup.
      const catRankMap = new Map<string, number>();
      if (isCategories && rosterPlayers.length >= 3) {
        const composite = buildCompositeScatter(rosterPlayers);
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
            const fallbackFpts = prevSeasonFptsMap.get(p.player_id) ?? 0;
            return {
              player_id: p.player_id,
              position: p.position,
              status: p.status,
              roster_slot: prevSlots.get(p.player_id) ?? "BE",
              avgFpts: isCategories
                ? catRankMap.get(p.player_id) ?? 0
                : hasMeaningfulSample
                  ? currentFpts
                  : fallbackFpts || currentFpts,
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
  function resolveSlotStats(player: RosterPlayer | null): {
    fpts: number | null;
    statLine: string | null;
    isLive: boolean;
    matchup: string | null;
    gameTimeUtc: string | null;
  } {
    if (!player || !scoringWeights)
      return {
        fpts: null,

        statLine: null,
        isLive: false,
        matchup: null,
        gameTimeUtc: null,
      };

    if (isToday) {
      const live = liveMap.get(player.player_id);
      const scheduleEntry = player.nbaTricode
        ? (daySchedule?.get(player.nbaTricode) ?? null)
        : null;
      const todayMatchup = scheduleEntry?.matchup ?? null;
      const todayGameTime = scheduleEntry?.gameTimeUtc ?? null;
      const hasGame = !!live || !!todayMatchup;
      if (!hasGame)
        return {
          fpts: null,
  
          statLine: null,
          isLive: false,
          matchup: null,
          gameTimeUtc: null,
        };

      if (live) {
        const stats = liveToGameLog(live);
        const fpts = isCategories
          ? null
          : Math.round(
              calculateGameFantasyPoints(stats as unknown as PlayerGameLog, scoringWeights) * 10,
            ) / 10;
        return {
          fpts,
  
          statLine:
            live.game_status === 1
              ? null
              : buildStatLine(stats as Record<string, number>),
          isLive: live.game_status === 2,
          matchup: live.matchup || null,
          gameTimeUtc: null,
        };
      }
      return {
        fpts: isCategories ? null : 0,
        statLine: null,
        isLive: false,
        matchup: todayMatchup,
        gameTimeUtc: todayGameTime,
      };
    }

    if (isPastDate) {
      const live = liveMap.get(player.player_id);
      // Still-live game from yesterday that crossed midnight
      if (live && live.game_status === 2) {
        const stats = liveToGameLog(live);
        const fpts = isCategories
          ? null
          : Math.round(
              calculateGameFantasyPoints(stats as unknown as PlayerGameLog, scoringWeights) * 10,
            ) / 10;
        return {
          fpts,
          statLine: buildStatLine(stats as Record<string, number>),
          isLive: true,
          matchup: live.matchup || null,
          gameTimeUtc: null,
        };
      }
      const dayGame = dayGameStats?.get(player.player_id);
      if (dayGame) {
        const stats = dayToStatRecord(dayGame);
        const fpts = isCategories
          ? null
          : Math.round(
              calculateGameFantasyPoints(stats as unknown as PlayerGameLog, scoringWeights) * 10,
            ) / 10;
        return {
          fpts,
          statLine: buildStatLine(stats as Record<string, number>),
          isLive: false,
          matchup: dayGame.matchup ?? null,
          gameTimeUtc: null,
        };
      }
      // Fall back to the final-state live row when player_games hasn't been
      // populated for this player/date yet — covers the gap between
      // live_player_stats writes and player_games writes during/after a game
      // ends, and any race where dayGameStats hasn't loaded.
      if (live && live.game_status === 3) {
        const stats = liveToGameLog(live);
        const fpts = isCategories
          ? null
          : Math.round(
              calculateGameFantasyPoints(stats as unknown as PlayerGameLog, scoringWeights) * 10,
            ) / 10;
        return {
          fpts,
          statLine: buildStatLine(stats as Record<string, number>),
          isLive: false,
          matchup: live.matchup || null,
          gameTimeUtc: null,
        };
      }
      return {
        fpts: null,
        statLine: null,
        isLive: false,
        matchup: null,
        gameTimeUtc: null,
      };
    }

    // Future — player must have a game that day
    const futureEntry = player.nbaTricode
      ? (daySchedule?.get(player.nbaTricode) ?? null)
      : null;
    const futureMatchup = futureEntry?.matchup ?? null;
    const futureGameTime = futureEntry?.gameTimeUtc ?? null;
    if (!futureMatchup) {
      return {
        fpts: null,

        statLine: null,
        isLive: false,
        matchup: null,
        gameTimeUtc: null,
      };
    }
    return {
      fpts: isCategories ? null : 0,
      statLine: null,
      isLive: false,
      matchup: futureMatchup,
      gameTimeUtc: futureGameTime,
    };
  }

  // Compute eligible destination keys for inline highlights behind the modal
  const eligibleDestKeys = useMemo(() => {
    if (!activeSlot?.player) return new Set<string>();
    const isIrOrTaxiSrc =
      activeSlot.slotPosition === "IR" || activeSlot.slotPosition === ROSTER_SLOT.TAXI;
    if (isIrOrTaxiSrc) return new Set<string>();
    const dests = getEligibleDestinations();
    return new Set(dests.map((d) => `${d.slot.slotPosition}-${d.slot.slotIndex}`));
  }, [activeSlot, rosterPlayers, scoringWeights, daySchedule]);

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
    const { fpts, statLine, isLive, matchup, gameTimeUtc } =
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

    // Inline highlight: this slot is an eligible destination for the selected player
    const isEligibleDest =
      !!activeSlot?.player &&
      !isActive &&
      eligibleDestKeys.has(`${slot.slotPosition}-${slot.slotIndex}`);

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
          isActive && {
            backgroundColor: c.activeCard,
            borderLeftWidth: 3,
            borderLeftColor: c.gold,
          },
          isEligibleDest && {
            borderLeftWidth: 2,
            borderLeftColor: c.gold + "66",
            backgroundColor: c.gold + "0A",
          },
        ]}
      >
        {/* Slot pill — refined chip replaces the old column-stripe label. */}
        <TouchableOpacity
          style={[
            styles.slotPill,
            {
              backgroundColor: slot.player ? c.cardAlt : "transparent",
              borderColor: isActive ? c.gold : c.border,
              borderWidth: isActive ? 1.5 : 1,
            },
            locked && !isIrOrTaxi && { opacity: 0.6 },
          ]}
          onPress={() =>
            !isPastDate && (!locked || isIrOrTaxi) && setActiveSlot(slot)
          }
          accessibilityRole="button"
          accessibilityLabel={`${slotLabel(slot.slotPosition)} slot${slot.player ? `, ${slot.player.name}` : ", empty"}`}
          accessibilityState={{
            selected: isActive,
            disabled: isPastDate || (locked && !isIrOrTaxi),
          }}
          accessibilityHint={
            isPastDate || (locked && !isIrOrTaxi)
              ? undefined
              : "Opens slot picker"
          }
        >
          <ThemedText
            type="varsitySmall"
            style={[
              styles.slotPillText,
              {
                color: isActive
                  ? c.gold
                  : slot.player
                    ? c.text
                    : c.secondaryText,
              },
            ]}
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
            accessibilityLabel={`${slot.player!.name}, ${formatPosition(slot.player!.position)}, ${slot.player!.pro_team}${matchupDisplay ? `, ${matchupDisplay}` : ""}${!isCategories && fpts !== null ? `, ${formatScore(fpts)} fantasy points` : ""}${isLive ? ", live" : ""}${locked ? ", locked" : ""}`}
            accessibilityHint="Tap for player details, long press to change slot"
          >
            {/* Headshot + team pill + on-court dot (all anchored to the wrap) */}
            <View style={styles.rosterPortraitWrap} accessible={false}>
              <View
                style={[
                  styles.rosterHeadshotCircle,
                  {
                    borderColor: isOnCourt ? c.success : c.heritageGold,
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
              {/* Name + injury badge */}
              <View style={styles.slotLine1}>
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

              {/* Matchup chip + live game info — chip turns success-tinted when live.
                  Pre-game falls through to the position label here; the upcoming
                  matchup is shown in the FPTS column instead. */}
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
                  ) : null}
                </View>
              ) : (
                <ThemedText
                  type="varsitySmall"
                  style={[
                    styles.slotMatchupText,
                    { color: c.secondaryText },
                  ]}
                  numberOfLines={1}
                >
                  {formatPosition(slot.player.position)}
                </ThemedText>
              )}

              {/* Past-day stat line — mono */}
              {statLine ? (
                <ThemedText
                  style={[styles.slotStatLine, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {statLine}
                </ThemedText>
              ) : null}
            </View>

            {/* FPTS column — pre-game shows the upcoming matchup chip + tipoff
                time here instead of a meaningless 0.0. Live/final keep the
                animated FPTS readout (with breakdown affordance). */}
            {!isCategories && isPreGame ? (
              <View style={styles.slotUpcoming} accessible={false}>
                <MatchupChip matchup={matchup!} c={c} alignSelf="flex-end" />
                {gameTimeUtc ? (
                  <ThemedText
                    type="varsitySmall"
                    style={[
                      styles.slotUpcomingTime,
                      { color: c.secondaryText },
                    ]}
                    numberOfLines={1}
                  >
                    {formatGameTime(gameTimeUtc)}
                  </ThemedText>
                ) : null}
              </View>
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
            style={[
              styles.slotPlayer,
              locked && !isIrOrTaxi && { opacity: 0.6 },
            ]}
            onPress={() => (!locked || isIrOrTaxi) && setActiveSlot(slot)}
            accessibilityRole="button"
            accessibilityLabel={`Empty ${slotLabel(slot.slotPosition)} slot, tap to assign`}
            accessibilityState={{
              disabled: locked && !isIrOrTaxi,
            }}
            accessibilityHint={
              locked && !isIrOrTaxi
                ? undefined
                : "Opens slot picker to assign a player"
            }
          >
            <View style={styles.rosterPortraitWrap}>
              <View
                style={[
                  styles.emptyHeadshot,
                  { borderColor: c.border, backgroundColor: c.cardAlt },
                ]}
              >
                <Ionicons name="add" size={20} color={c.secondaryText} />
              </View>
            </View>
            <View style={styles.slotPlayerInfo}>
              <ThemedText
                type="varsitySmall"
                style={[styles.emptySlotEyebrow, { color: c.gold }]}
              >
                OPEN SLOT
              </ThemedText>
              <ThemedText
                style={[styles.emptySlotHint, { color: c.secondaryText }]}
              >
                Tap to assign a player
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
        dayLabel={formatDayLabel(selectedDate)}
        myTeam={heroMatchup?.me ?? null}
        opponent={heroMatchup?.opponent ?? null}
        isBye={heroMatchup?.isBye ?? false}
        myScore={heroMyScore}
        oppScore={heroOppScore}
        weekIsLive={weekIsLive}
        playCount={heroPlayCount}
        lockedCount={heroLockedCount}
        emptyCount={heroEmptyCount}
        rosterStats={heroRosterStats}
        onPrevDay={() =>
          canGoBack && setSelectedDate(addDays(selectedDate, -1))
        }
        onNextDay={() => setSelectedDate(addDays(selectedDate, 1))}
        onGoToToday={() => setSelectedDate(today)}
      />

      {irLocked && <IrLockBanner players={illegalIRPlayers ?? []} />}

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
                <TouchableOpacity
                  onPress={shareRoster}
                  disabled={isSharing}
                  style={[
                    styles.headerPill,
                    { backgroundColor: c.cardAlt, borderColor: c.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Share roster as image"
                  accessibilityState={{ disabled: isSharing }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {isSharing ? (
                    <LogoSpinner size={14} delay={0} />
                  ) : (
                    <Ionicons name="share-outline" size={14} color={c.gold} />
                  )}
                </TouchableOpacity>
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

      {/* Slot Picker Modal */}
      {!isPastDate && (
        <SlotPickerModal
          visible={!!activeSlot}
          sourceSlot={activeSlot}
          destinations={activeSlot ? getEligibleDestinations() : []}
          quickActions={activeSlot ? getQuickActions() : []}
          eligiblePlayers={activeSlot ? getEligibleFillPlayers() : []}
          daySchedule={daySchedule}
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

