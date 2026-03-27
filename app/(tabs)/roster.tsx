import { capture } from "@/lib/posthog";
import { ErrorState } from "@/components/ErrorState";
import { FptsBreakdownModal } from "@/components/player/FptsBreakdownModal";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import {
  DestinationSlot,
  QuickAction,
  RosterPlayer,
  SlotEntry,
  SlotPickerModal,
} from "@/components/roster/SlotPickerModal";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useToast } from "@/context/ToastProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeague } from "@/hooks/useLeague";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { LineupPlayer, optimizeLineup } from "@/utils/autoLineup";
import { fetchTeamSlots } from "@/utils/fetchTeamSlots";
import { useRosterChanges } from "@/hooks/useRosterChanges";
import { addDays, formatDayLabel, toDateStr, useToday } from "@/utils/dates";
import {
  calculateAvgFantasyPoints,
  calculateGameFantasyPoints,
  formatScore,
} from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { hasAnyGameStarted, isGameStarted, useTodayGameTimes } from "@/utils/gameStarted";
import { getInjuryBadge } from "@/utils/injuryBadge";
import {
  formatGameInfo,
  liveToGameLog,
  useLivePlayerStats,
} from "@/utils/nbaLive";
import {
  fetchNbaScheduleForDate,
  formatGameTime,
  ScheduleEntry,
} from "@/utils/nbaSchedule";
import { isOnline } from "@/utils/network";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { isEligibleForSlot, slotLabel } from "@/utils/rosterSlots";
import { isTaxiEligible } from "@/utils/taxiEligibility";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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

// ─── Animated FPTS number ────────────────────────────────────────────────────
// Pops (scale 1 → 1.35 → 1) whenever value changes.

function AnimatedFpts({
  value,
  accentColor,
  dimColor,
  textStyle,
  animate = false,
  projected = false,
}: {
  value: number | null;
  accentColor: string;
  dimColor: string;
  textStyle: any;
  animate?: boolean;
  projected?: boolean;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const prev = useRef<number | null | undefined>(undefined);
  const wasAnimating = useRef(false);

  useEffect(() => {
    if (
      animate &&
      wasAnimating.current &&
      prev.current !== undefined &&
      value !== prev.current
    ) {
      const goingUp = (value ?? 0) > (prev.current ?? 0);
      translateY.setValue(goingUp ? 14 : -14);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    prev.current = value;
    wasAnimating.current = animate;
  }, [value, animate]);

  return (
    <View style={{ overflow: "hidden", height: 18, justifyContent: "center" }}>
      <Animated.Text
        style={[
          textStyle,
          {
            transform: [{ translateY }],
            color: value !== null ? accentColor : dimColor,
          },
        ]}
      >
        {value !== null
          ? projected
            ? value.toFixed(1)
            : formatScore(value)
          : "—"}
      </Animated.Text>
    </View>
  );
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchTeamRosterForDate(
  teamId: string,
  leagueId: string,
  date: string,
  weekBounds?: { start_date: string; end_date: string },
): Promise<RosterPlayer[]> {
  // Use the same slot resolution as the matchup page — guarantees parity
  const slots = await fetchTeamSlots(teamId, leagueId, date, weekBounds);

  const today = toDateStr(new Date());
  const isPast = date < today;

  // Filter out players who weren't on the team on this date:
  // - If resolveSlot returns a real slot (from daily_lineups), the player was here — show them
  // - If resolveSlot returns 'BE' and acquired_at is after this date, they weren't here yet — hide
  // - This handles re-acquisitions correctly (Giannis: traded away/back, but daily_lineups proves
  //   presence on earlier dates even though acquired_at was overwritten by the trade)
  const currentForDate = [...slots.currentPlayerIds].filter((pid) => {
    const slot = slots.slotMap.get(pid);
    if (slot && slot !== "BE") return true; // has a real slot assignment — was on team
    const acquired = slots.acquiredDateMap.get(pid);
    if (acquired && date < acquired) return false; // no slot + acquired after this date
    return true;
  });

  const droppedForDate = isPast
    ? slots.droppedPlayerIds.filter((pid) => {
        const slot = slots.slotMap.get(pid);
        return slot && slot !== "DROPPED"; // only show if they had an active slot that day
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
      .select("id, name, position, nba_team, external_id_nba, status")
      .in("id", allPlayerIds),
  ]);

  if (statsResult.error) throw statsResult.error;

  // Build player info map for fallback when player_season_stats is missing
  const playerInfoMap = new Map<string, any>();
  for (const p of playersResult.data ?? []) playerInfoMap.set(p.id, p);

  const nbaTricodeMap = new Map<string, string>(
    (playersResult.data ?? [])
      .filter(
        (p: any) =>
          p.nba_team && p.nba_team !== "Active" && p.nba_team !== "Inactive",
      )
      .map((p: any) => [p.id, p.nba_team]),
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
      nba_team: info?.nba_team ?? "—",
      status: info?.status ?? "active",
      external_id_nba: info?.external_id_nba ?? null,
      rookie: false,
      season_added: null,
      nba_draft_year: null,
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


  const isPastDate = selectedDate < today;
  const isFutureDate = selectedDate > today;
  const isToday = selectedDate === today;
  const yesterday = addDays(today, -1);
  const isYesterday = selectedDate === yesterday;

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? "");
  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === "h2h_categories";
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId ?? "");

  // Current matchup week bounds (used to scope the Auto button)
  const { data: currentWeek } = useQuery({
    queryKey: ["currentMatchupWeek", leagueId, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("league_schedule")
        .select("start_date, end_date")
        .eq("league_id", leagueId!)
        .lte("start_date", today)
        .gte("end_date", today)
        .maybeSingle();
      return data as { start_date: string; end_date: string } | null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 60,
  });
  // Earliest date this team acquired a player — prevents navigating before the roster existed
  const { data: rosterStartDate } = useQuery({
    queryKey: ["rosterStartDate", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("league_players")
        .select("acquired_at")
        .eq("team_id", teamId!)
        .order("acquired_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!data?.acquired_at) return null;
      return toDateStr(new Date(data.acquired_at));
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  const canGoBack = !rosterStartDate || selectedDate > rosterStartDate;

  const canAutoLineup =
    !!currentWeek &&
    selectedDate >= today &&
    selectedDate <= currentWeek.end_date;

  const {
    data: rosterPlayers,
    isLoading: isLoadingRoster,
    isError: isRosterError,
    refetch: refetchRoster,
  } = useQuery<RosterPlayer[]>({
    queryKey: ["teamRoster", teamId, selectedDate],
    queryFn: () => fetchTeamRosterForDate(teamId!, leagueId!, selectedDate, currentWeek ?? undefined),
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 30, // 30s — useRosterChanges handles realtime invalidation
    placeholderData: keepPreviousData,
  });

  // For past dates: fetch that day's actual game stats
  const { data: dayGameStats } = useQuery<Map<string, DayGameStats>>({
    queryKey: ["dayGameStats", teamId, selectedDate],
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
    queryKey: ["daySchedule", selectedDate],
    queryFn: () => fetchNbaScheduleForDate(selectedDate),
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
    const todayStr = toDateStr(new Date());
    for (const day of adjacent) {
      queryClient.prefetchQuery({
        queryKey: ["teamRoster", teamId, day],
        queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day),
        staleTime: 1000 * 60 * 2,
      });
      if (day >= todayStr) {
        queryClient.prefetchQuery({
          queryKey: ["daySchedule", day],
          queryFn: () => fetchNbaScheduleForDate(day),
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

  // Players acquired today whose game has already started shouldn't appear until tomorrow
  const filteredRosterPlayers = useMemo(() => {
    if (!rosterPlayers || !isToday) return rosterPlayers;
    return rosterPlayers.filter((p) => {
      if (!p.acquired_at) return true;
      const acquiredDate = toDateStr(new Date(p.acquired_at));
      if (acquiredDate !== today) return true;
      // Acquired today — exclude if their game has already started
      const liveStatus = liveMap.get(p.player_id)?.game_status;
      return !isGameStarted(p.nbaTricode, gameTimeMap, liveStatus);
    });
  }, [rosterPlayers, isToday, today, gameTimeMap, liveMap]);

  // ─── Build slot entries ───────────────────────────────────────────────────

  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];
  const irSlots: SlotEntry[] = [];
  const taxiSlots: SlotEntry[] = [];

  if (rosterConfig && filteredRosterPlayers) {
    const benchConfig = rosterConfig.find((c) => c.position === "BE");
    const irConfig = rosterConfig.find((c) => c.position === "IR");
    const taxiConfig = rosterConfig.find((c) => c.position === "TAXI");
    const activeConfigs = rosterConfig.filter(
      (c) =>
        c.position !== "BE" && c.position !== "IR" && c.position !== "TAXI",
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
            filteredRosterPlayers.find(
              (p) =>
                p.roster_slot === numberedSlot &&
                !placedPlayerIds.has(p.player_id),
            ) ?? null;
          if (player) placedPlayerIds.add(player.player_id);
          slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
        }
      } else {
        const playersInSlot = filteredRosterPlayers.filter(
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

    for (const player of filteredRosterPlayers) {
      if (player.roster_slot === "IR" || player.roster_slot === "TAXI")
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
      const irPlayers = filteredRosterPlayers.filter(
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
      const taxiPlayers = filteredRosterPlayers.filter(
        (p) => p.roster_slot === "TAXI",
      );
      const taxiSlotCount = Math.max(taxiConfig.slot_count, taxiPlayers.length);
      for (let i = 0; i < taxiSlotCount; i++) {
        taxiSlots.push({
          slotPosition: "TAXI",
          slotIndex: i,
          player: taxiPlayers[i] ?? null,
        });
      }
    }
  }

  const starterSlots = slots.filter((s) => s.slotPosition !== "BE");
  const benchSlots = slots.filter((s) => s.slotPosition === "BE");

  // ─── Slot picker helpers ──────────────────────────────────────────────────

  /** Compute destination slots for the selected player (dest mode). */
  const getEligibleDestinations = (): DestinationSlot[] => {
    if (!activeSlot?.player || !filteredRosterPlayers) return [];

    const player = activeSlot.player;
    const srcSlot = activeSlot.slotPosition;
    const srcIsBench = srcSlot === "BE";
    const srcIsStarter =
      srcSlot !== "BE" && srcSlot !== "IR" && srcSlot !== "TAXI";
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
        s.slotPosition !== "TAXI";
      const dstIsBench = s.slotPosition === "BE";

      // IR/TAXI destinations handled by quick actions
      if (s.slotPosition === "IR" || s.slotPosition === "TAXI") continue;

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
      srcSlot !== "BE" && srcSlot !== "IR" && srcSlot !== "TAXI";
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
        (player as any).nba_draft_year ?? null,
        league?.season ?? "",
        league?.taxi_max_experience ?? null,
      )
    )
      actions.push("taxi");

    return actions;
  };

  /** Compute eligible players for empty slots or IR/TAXI (fill mode). */
  const getEligibleFillPlayers = (): RosterPlayer[] => {
    if (!activeSlot || !filteredRosterPlayers) return [];
    const slotPos = activeSlot.slotPosition;
    const isIR = slotPos === "IR";
    const isTaxi = slotPos === "TAXI";
    const currentPlayer = activeSlot.player;

    return filteredRosterPlayers.filter((p) => {
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
          (p as any).nba_draft_year ?? null,
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
          p.roster_slot !== "TAXI"
        );
      }

      // Empty starter: position-eligible, not on taxi
      if (p.roster_slot === "TAXI") return false;
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
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        lineup_date: dateOverride ?? selectedDate,
        roster_slot: slot,
      },
      { onConflict: "team_id,player_id,lineup_date" },
    );
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

    setIsAssigning(true);
    try {
      const srcIsIR = sourceSlotPosition === "IR";
      const srcIsTaxi = sourceSlotPosition === "TAXI";
      const dstIsIR = destSlotPosition === "IR";
      const dstIsTaxi = destSlotPosition === "TAXI";
      const isIrTaxiInvolved = srcIsIR || srcIsTaxi || dstIsIR || dstIsTaxi;

      const deferred =
        isIrTaxiInvolved &&
        (isPlayerLocked(sourcePlayer) || isPlayerLocked(destPlayer));
      const effectiveDate = deferred ? addDays(today, 1) : selectedDate;

      // ── 1. Displace destination player ──
      if (destPlayer) {
        if (dstIsIR) {
          await upsertDailySlot(destPlayer.player_id, "BE", effectiveDate);
          await supabase
            .from("daily_lineups")
            .update({ roster_slot: "BE" })
            .eq("team_id", teamId)
            .eq("league_id", leagueId)
            .eq("player_id", destPlayer.player_id)
            .eq("roster_slot", "IR")
            .gt("lineup_date", effectiveDate);
          await supabase
            .from("league_players")
            .update({ roster_slot: "BE" })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", destPlayer.player_id);
        } else if (dstIsTaxi) {
          await upsertDailySlot(destPlayer.player_id, "BE", effectiveDate);
          await supabase
            .from("league_players")
            .update({ roster_slot: "BE" })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("player_id", destPlayer.player_id);
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
        await supabase
          .from("daily_lineups")
          .update({ roster_slot: "IR" })
          .eq("team_id", teamId)
          .eq("league_id", leagueId)
          .eq("player_id", sourcePlayer.player_id)
          .gt("lineup_date", effectiveDate);
        await supabase
          .from("league_players")
          .update({ roster_slot: "IR" })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", sourcePlayer.player_id);
      } else if (dstIsTaxi) {
        await supabase
          .from("league_players")
          .update({ roster_slot: "TAXI" })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", sourcePlayer.player_id);
      } else if (srcIsIR) {
        await supabase
          .from("daily_lineups")
          .update({ roster_slot: "BE" })
          .eq("team_id", teamId)
          .eq("league_id", leagueId)
          .eq("player_id", sourcePlayer.player_id)
          .eq("roster_slot", "IR")
          .gt("lineup_date", effectiveDate);
        await supabase
          .from("league_players")
          .update({ roster_slot: destSlotPosition })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", sourcePlayer.player_id);
      } else if (srcIsTaxi) {
        await supabase
          .from("daily_lineups")
          .update({ roster_slot: "BE" })
          .eq("team_id", teamId)
          .eq("league_id", leagueId)
          .eq("player_id", sourcePlayer.player_id)
          .eq("roster_slot", "TAXI")
          .gt("lineup_date", effectiveDate);
        await supabase
          .from("league_players")
          .update({ roster_slot: destSlotPosition })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", sourcePlayer.player_id);
      }

      // ── 4. Query invalidation ──
      if (isIrTaxiInvolved) {
        queryClient.invalidateQueries({
          queryKey: ["rosterInfo", leagueId, teamId],
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
            queryKey: ["teamRoster", teamId, day],
            queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day),
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
          queryKey: ["teamRoster", teamId, selectedDate],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["weekMatchup", leagueId],
      });
      capture('lineup_change');
      setActiveSlot(null);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to move player");
    } finally {
      setIsAssigning(false);
    }
  };

  // ─── Auto-lineup optimizer ──────────────────────────────────────────────

  const promptAutoLineup = () => {
    if (
      !filteredRosterPlayers ||
      !rosterConfig ||
      !scoringWeights ||
      !teamId ||
      !leagueId
    )
      return;

    Alert.alert("Auto-Lineup", "Optimize for today only or the rest of the week?", [
      { text: "Cancel", style: "cancel" },
      { text: "Today", onPress: () => runAutoLineup("today") },
      { text: "Week", onPress: () => runAutoLineup("week") },
    ]);
  };

  const runAutoLineup = async (mode: "today" | "week") => {
    if (
      !filteredRosterPlayers ||
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

      // 2. Batch-fetch NBA schedule for the entire date range
      const { data: nbaGames } = await supabase
        .from("nba_schedule")
        .select("game_date, home_team, away_team")
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
        filteredRosterPlayers.map((p) => [p.player_id, p.roster_slot ?? "BE"]),
      );
      let totalMoves = 0;
      let daysChanged = 0;

      for (const date of dates) {
        const teamsPlaying = teamsPlayingByDate.get(date);
        const isDateToday = date === today;

        const lineupPlayers: LineupPlayer[] = filteredRosterPlayers.map(
          (p) => ({
            player_id: p.player_id,
            position: p.position,
            status: p.status,
            roster_slot: prevSlots.get(p.player_id) ?? "BE",
            avgFpts: calculateAvgFantasyPoints(p, scoringWeights),
            locked: isDateToday ? isPlayerLocked(p) : false,
            hasGame: teamsPlaying?.has(p.nbaTricode ?? "") ?? false,
          }),
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
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to optimize lineup");
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
              calculateGameFantasyPoints(stats as any, scoringWeights) * 10,
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
      // Check for still-live games from yesterday that crossed midnight
      const live = liveMap.get(player.player_id);
      if (live && live.game_status === 2) {
        const stats = liveToGameLog(live);
        const fpts = isCategories
          ? null
          : Math.round(
              calculateGameFantasyPoints(stats as any, scoringWeights) * 10,
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
              calculateGameFantasyPoints(stats as any, scoringWeights) * 10,
            ) / 10;
        return {
          fpts,
  
          statLine: buildStatLine(stats as Record<string, number>),
          isLive: false,
          matchup: dayGame.matchup ?? null,
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
      activeSlot.slotPosition === "IR" || activeSlot.slotPosition === "TAXI";
    if (isIrOrTaxiSrc) return new Set<string>();
    const dests = getEligibleDestinations();
    return new Set(dests.map((d) => `${d.slot.slotPosition}-${d.slot.slotIndex}`));
  }, [activeSlot, filteredRosterPlayers, scoringWeights, daySchedule]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ActivityIndicator style={styles.centered} />
      </SafeAreaView>
    );
  }

  if (isRosterError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ErrorState
          message="Failed to load roster"
          onRetry={() => refetchRoster()}
        />
      </SafeAreaView>
    );
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        {/* Day navigation — always visible so users aren't trapped on an empty date */}
        <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
          <TouchableOpacity
            onPress={() => canGoBack && setSelectedDate(addDays(selectedDate, -1))}
            disabled={!canGoBack}
            style={[styles.navArrow, !canGoBack && { opacity: 0.3 }]}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            accessibilityState={{ disabled: !canGoBack }}
          >
            <Text style={[styles.navArrowText, { color: c.text }]}>‹</Text>
          </TouchableOpacity>

          <View style={styles.dayInfo}>
            <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
              {formatDayLabel(selectedDate)}
            </ThemedText>
          </View>

          <TouchableOpacity
            onPress={() => setSelectedDate(addDays(selectedDate, 1))}
            style={styles.navArrow}
            accessibilityRole="button"
            accessibilityLabel="Next day"
          >
            <Text style={[styles.navArrowText, { color: c.text }]}>›</Text>
          </TouchableOpacity>

          {selectedDate !== today && (
            <TouchableOpacity
              onPress={() => setSelectedDate(today)}
              style={[
                styles.todayChip,
                isFutureDate ? styles.todayChipLeft : styles.todayChipRight,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
            >
              <ThemedText style={[styles.todayChipText, { color: c.accent }]}>
                Today
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.centered}>
          <ThemedText style={{ color: c.secondaryText }}>
            No players on your roster yet.
          </ThemedText>
        </View>
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
    const matchupDisplay = matchup
      ? gameTimeUtc && !isLive
        ? `${matchup} · ${formatGameTime(gameTimeUtc)}`
        : matchup
      : null;
    const liveData = slot.player ? liveMap.get(slot.player.player_id) : null;
    const gameInfo = liveData ? formatGameInfo(liveData) : "";
    const locked = isPlayerLocked(slot.player);
    const isIrOrTaxi =
      slot.slotPosition === "IR" || slot.slotPosition === "TAXI";

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
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
          isActive && {
            backgroundColor: c.activeCard,
            borderLeftWidth: 3,
            borderLeftColor: c.accent,
          },
          isEligibleDest && {
            borderLeftWidth: 2,
            borderLeftColor: c.accent + "66",
            backgroundColor: c.accent + "0A",
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.slotLabel,
            {
              backgroundColor: isActive
                ? c.activeCard
                : slot.player
                  ? c.activeCard
                  : c.cardAlt,
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
            style={[
              styles.slotLabelText,
              {
                color: isActive
                  ? c.accent
                  : slot.player
                    ? c.activeText
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
            accessibilityLabel={`${slot.player!.name}, ${formatPosition(slot.player!.position)}, ${slot.player!.nba_team}${matchupDisplay ? `, ${matchupDisplay}` : ""}${!isCategories && fpts !== null ? `, ${formatScore(fpts)} fantasy points` : ""}${isLive ? ", live" : ""}${locked ? ", locked" : ""}`}
            accessibilityHint="Tap for player details, long press to change slot"
          >
            {/* Headshot with team pill + on-court dot */}
            <View style={styles.rosterPortraitWrap} accessible={false}>
              {(() => {
                const url = getPlayerHeadshotUrl(slot.player.external_id_nba);
                return (
                  <View
                    style={[
                      styles.rosterHeadshotCircle,
                      { borderColor: c.gold, backgroundColor: c.cardAlt },
                    ]}
                    accessible={false}
                  >
                    {url ? (
                      <Image
                        source={{ uri: url }}
                        style={styles.rosterHeadshotImg}
                        resizeMode="cover"
                        accessible={false}
                      />
                    ) : null}
                  </View>
                );
              })()}
              {liveData?.oncourt && liveData.game_status === 2 && (
                <View style={[styles.onCourtDot, { backgroundColor: c.success }]} accessible={false} />
              )}
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.nba_team);
                return (
                  <View style={styles.rosterTeamPill}>
                    {logoUrl && (
                      <Image
                        source={{ uri: logoUrl }}
                        style={styles.rosterTeamPillLogo}
                        resizeMode="contain"
                      />
                    )}
                    <Text style={[styles.rosterTeamPillText, { color: c.statusText }]}>
                      {slot.player.nba_team}
                    </Text>
                  </View>
                );
              })()}
            </View>
            <View style={styles.slotPlayerInfo}>
              {/* Line 1: ● Name | badges */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  flexWrap: "wrap",
                  flexShrink: 1,
                }}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={[styles.slotPlayerName]}
                >
                  {slot.player.name}
                </ThemedText>
                {matchupDisplay && (
                  <View
                    accessible={false}
                    style={[
                      styles.matchupChip,
                      { backgroundColor: c.cardAlt },
                      isLive && [styles.matchupChipLive, { borderColor: c.success }],
                    ]}
                  >
                    <Text
                      style={[
                        styles.matchupChipText,
                        { color: isLive ? c.success : c.secondaryText },
                      ]}
                    >
                      {matchupDisplay}
                    </Text>
                  </View>
                )}
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
              {/* Line 2: context-dependent sub-line */}
              {isFutureDate || (isToday && !isLive && !statLine && matchup) ? (
                <ThemedText
                  style={[styles.slotPlayerSub, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {formatPosition(slot.player.position)}
                </ThemedText>
              ) : gameInfo || statLine ? (
                <ThemedText
                  style={[styles.slotPlayerSub, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {[gameInfo, statLine].filter(Boolean).join(" · ")}
                </ThemedText>
              ) : (
                <ThemedText
                  style={[styles.slotPlayerSub, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {formatPosition(slot.player.position)}
                </ThemedText>
              )}
            </View>
            {!isCategories &&
              (() => {
                const isProjected = isFutureDate;
                // Determine if we can show a breakdown (actual game stats, not projected)
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
                      accentColor={c.accent}
                      dimColor={c.secondaryText}
                      textStyle={styles.slotFpts}
                      animate={isToday}
                      projected={false}
                    />
                  </TouchableOpacity>
                ) : (
                  <AnimatedFpts
                    value={fpts}
                    accentColor={c.accent}
                    dimColor={c.secondaryText}
                    textStyle={styles.slotFpts}
                    animate={isToday}
                    projected={isProjected}
                  />
                );
              })()}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => !isPastDate && setActiveSlot(slot)}
            accessibilityRole="button"
            accessibilityLabel={`Empty ${slotLabel(slot.slotPosition)} slot`}
            accessibilityState={{ disabled: isPastDate }}
            accessibilityHint={
              isPastDate ? undefined : "Opens slot picker to assign a player"
            }
          >
            <ThemedText
              style={[styles.emptySlotText, { color: c.secondaryText }]}
            >
              Empty
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      {/* Day navigation */}
      <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          onPress={() => canGoBack && setSelectedDate(addDays(selectedDate, -1))}
          disabled={!canGoBack}
          style={[styles.navArrow, !canGoBack && { opacity: 0.3 }]}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          accessibilityState={{ disabled: !canGoBack }}
        >
          <Text style={[styles.navArrowText, { color: c.text }]}>‹</Text>
        </TouchableOpacity>

        <View style={styles.dayInfo}>
          <View>
            <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
              {formatDayLabel(selectedDate)}
            </ThemedText>
          </View>
          {isPastDate && (
            <ThemedText
              style={[styles.daySubLabel, { color: c.secondaryText }]}
            >
              Past lineup (read-only)
            </ThemedText>
          )}
          {isToday && (
            <ThemedText
              style={[styles.daySubLabel, { color: c.secondaryText }]}
            >
              Today's lineup
            </ThemedText>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setSelectedDate(addDays(selectedDate, 1))}
          style={styles.navArrow}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Text style={[styles.navArrowText, { color: c.text }]}>›</Text>
        </TouchableOpacity>

        {selectedDate !== today && (
          <TouchableOpacity
            onPress={() => setSelectedDate(today)}
            style={[
              styles.todayChip,
              isFutureDate ? styles.todayChipLeft : styles.todayChipRight,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go to today"
          >
            <ThemedText style={[styles.todayChipText, { color: c.accent }]}>
              Today
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <ThemedText type="subtitle" accessibilityRole="header">
                Starters
              </ThemedText>
              {canAutoLineup && (
                <TouchableOpacity
                  onPress={promptAutoLineup}
                  disabled={isOptimizing}
                  style={[styles.autoButton, { backgroundColor: c.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel="Auto-optimize lineup"
                  accessibilityState={{ disabled: isOptimizing }}
                  accessibilityHint="Choose to optimize lineup for today or the rest of the week"
                >
                  {isOptimizing ? (
                    <ActivityIndicator
                      size="small"
                      color={c.statusText}
                      style={{ height: 14 }}
                    />
                  ) : (
                    <ThemedText style={[styles.autoButtonText, { color: c.statusText }]}>Auto</ThemedText>
                  )}
                </TouchableOpacity>
              )}
            </View>
            {!isCategories && starterTotal !== null && (
              <View
                style={[
                  styles.totalBadge,
                  {
                    backgroundColor: c.activeCard,
                    borderColor: c.activeBorder,
                  },
                ]}
                accessibilityLabel={`Fantasy points: ${formatScore(starterTotal)}`}
              >
                <ThemedText
                  style={[styles.totalLabel, { color: c.secondaryText }]}
                >
                  FPTS
                </ThemedText>
                <ThemedText
                  style={[styles.totalValue, { color: c.activeText }]}
                >
                  {formatScore(starterTotal)}
                </ThemedText>
              </View>
            )}
          </View>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {starterSlots.map((slot, idx) =>
              renderSlotRow(slot, idx, starterSlots),
            )}
          </View>
        </View>

        {/* Bench */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle" accessibilityRole="header">
              Bench
            </ThemedText>
          </View>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {benchSlots.length > 0 ? (
              benchSlots.map((slot, idx) =>
                renderSlotRow(slot, idx, benchSlots),
              )
            ) : (
              <View style={styles.emptyBench}>
                <ThemedText
                  style={[styles.emptySlotText, { color: c.secondaryText }]}
                >
                  No bench slots
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* IR */}
        {irSlots.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle" accessibilityRole="header">
                Injured Reserve
              </ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: c.card }]}>
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
            </View>
          </View>
        )}

        {/* Taxi Squad */}
        {taxiSlots.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle" accessibilityRole="header">
                Taxi Squad
              </ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: c.card }]}>
              {taxiSlots.map((slot, idx) =>
                renderSlotRow(slot, idx, taxiSlots),
              )}
            </View>
          </View>
        )}
      </ScrollView>

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
              const activeCount = filteredRosterPlayers?.filter(
                (p) => p.roster_slot !== "IR" && p.roster_slot !== "TAXI",
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
                  "TAXI",
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
              queryKey: ["teamRoster", teamId, day],
              queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day),
              staleTime: 0,
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  autoButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  autoButtonText: {
    fontSize: 11,
    fontWeight: "700",
  },
  scrollContent: { paddingBottom: 56 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dayNav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navArrow: { padding: 12 },
  navArrowText: { fontSize: 28, lineHeight: 32 },
  todayChip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  todayChipLeft: { left: 50 },
  todayChipRight: { right: 50 },
  dayInfo: { flex: 1, alignItems: "center" },
  dayLabel: { fontSize: 16 },
  daySubLabel: { fontSize: 11, marginTop: 2 },
  section: { padding: 16, paddingBottom: 0 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  totalBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    gap: 5,
  },
  totalLabel: { fontSize: 10, fontWeight: "600" },
  totalValue: {
    fontSize: 16,
    fontWeight: "700",
    minWidth: 44,
    textAlign: "right",
  },
  emptyBench: { padding: 16, alignItems: "center" },
  card: {
    borderRadius: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
  },
  slotLabel: {
    width: 44,
    alignSelf: "stretch",
    justifyContent: "center",
    alignItems: "center",
  },
  slotLabelText: { fontSize: 11, fontWeight: "700" },
  slotPlayer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  rosterPortraitWrap: {
    width: 50,
    height: 50,
    marginRight: 8,
    alignItems: "center",
  },
  onCourtDot: {
    position: "absolute" as const,
    top: 8,
    left: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 2,
  },
  rosterHeadshotCircle: {
    width: 48,
    height: 48,
    borderRadius: 25,
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  rosterHeadshotImg: {
    position: "absolute" as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: 42,
  },
  rosterTeamPill: {
    position: "absolute",
    bottom: -1,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
    gap: 2,
  },
  rosterTeamPillLogo: {
    width: 9,
    height: 9,
  },
  rosterTeamPillText: {
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  slotPlayerInfo: { flex: 1, marginRight: 8 },
  slotPlayerName: { fontSize: 14 },
  slotPlayerSub: { fontSize: 11, marginTop: 1 },
  slotFpts: { fontSize: 13, fontWeight: "600" },
  emptySlotText: { fontSize: 13, fontStyle: "italic" },
  todayChipText: { fontSize: 11, fontWeight: "600" },
  matchupChip: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  matchupChipLive: {
    borderWidth: 1,
  },
  matchupChipText: {
    fontSize: 9,
    fontWeight: "600" as const,
  },
  liveBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
