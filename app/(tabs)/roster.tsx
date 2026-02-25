import { ErrorState } from "@/components/ErrorState";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { fetchLineupForDate } from "@/utils/dailyLineup";
import { calculateAvgFantasyPoints, calculateGameFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { formatGameInfo, LivePlayerStats, useLivePlayerStats } from "@/utils/nbaLive";
import { useTodayGameTimes, isGameStarted } from "@/utils/gameStarted";
import { isEligibleForSlot, SLOT_LABELS } from "@/utils/rosterSlots";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
  nbaTricode: string | null; // real team tricode from players.nba_team (e.g. "OKC")
}

interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// Per-player game stats fetched for a specific past date
interface DayGameStats {
  player_id: string;
  pts: number; reb: number; ast: number; stl: number; blk: number;
  tov: number; fgm: number; fga: number; '3pm': number; ftm: number; fta: number; pf: number;
  matchup: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function formatDayLabel(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Compact stat line shown below player name: "20 PTS · 8 REB · 5 AST · 2 BLK · 1 PF"
function buildStatLine(stats: Record<string, number>): string {
  const fields: [string, string][] = [
    ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'],
    ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO'],
    ['3pm', '3PM'], ['pf', 'PF'],
  ];
  return fields
    .filter(([key]) => (stats[key] ?? 0) > 0)
    .map(([key, label]) => `${stats[key]} ${label}`)
    .join(' · ');
}

function liveToStatRecord(live: LivePlayerStats): Record<string, number> {
  return {
    pts: live.pts, reb: live.reb, ast: live.ast, stl: live.stl,
    blk: live.blk, tov: live.tov, fgm: live.fgm, fga: live.fga,
    '3pm': live['3pm'], ftm: live.ftm, fta: live.fta, pf: live.pf,
  };
}

function dayToStatRecord(g: DayGameStats): Record<string, number> {
  return {
    pts: g.pts, reb: g.reb, ast: g.ast, stl: g.stl,
    blk: g.blk, tov: g.tov, fgm: g.fgm, fga: g.fga,
    '3pm': g['3pm'], ftm: g.ftm, fta: g.fta, pf: g.pf,
  };
}

// ─── Animated FPTS number ────────────────────────────────────────────────────
// Pops (scale 1 → 1.35 → 1) whenever value changes.

function AnimatedFpts({
  value,
  accentColor,
  dimColor,
  textStyle,
}: {
  value: number | null;
  accentColor: string;
  dimColor: string;
  textStyle: any;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (prev.current !== undefined && value !== prev.current) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 150, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 12 }),
      ]).start();
    }
    prev.current = value;
  }, [value]);

  return (
    <Animated.Text
      style={[textStyle, { transform: [{ scale }], color: value !== null ? accentColor : dimColor }]}
    >
      {value !== null ? value.toFixed(1) : '—'}
    </Animated.Text>
  );
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchTeamRosterForDate(
  teamId: string,
  leagueId: string,
  date: string
): Promise<RosterPlayer[]> {
  const { data: leaguePlayers, error: lpError } = await supabase
    .from("league_players")
    .select("player_id, roster_slot")
    .eq("team_id", teamId)
    .eq("league_id", leagueId);

  if (lpError) throw lpError;
  if (!leaguePlayers || leaguePlayers.length === 0) return [];

  const playerIds = leaguePlayers.map((lp) => lp.player_id);
  const slotMap = await fetchLineupForDate(teamId, leagueId, date);

  const [statsResult, tricodeResult] = await Promise.all([
    supabase.from("player_season_stats").select("*").in("player_id", playerIds),
    supabase.from("players").select("id, nba_team").in("id", playerIds),
  ]);

  if (statsResult.error) throw statsResult.error;

  const nbaTricodeMap = new Map<string, string>(
    (tricodeResult.data ?? [])
      .filter((p: any) => p.nba_team && p.nba_team !== "Active" && p.nba_team !== "Inactive")
      .map((p: any) => [p.id, p.nba_team])
  );

  return (statsResult.data as PlayerSeasonStats[]).map((p) => ({
    ...p,
    roster_slot: slotMap.get(p.player_id) ?? null,
    nbaTricode: nbaTricodeMap.get(p.player_id) ?? null,
  }));
}

async function fetchNbaScheduleForDate(date: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("nba_schedule")
    .select("home_team, away_team")
    .eq("game_date", date);
  const map = new Map<string, string>();
  for (const game of data ?? []) {
    map.set(game.home_team, `vs ${game.away_team}`);
    map.set(game.away_team, `@${game.home_team}`);
  }
  return map;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RosterScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const queryClient = useQueryClient();

  const today = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(today);

  // If the calendar date rolled over since the component mounted, snap to today
  const prevToday = useRef(today);
  useEffect(() => {
    if (today !== prevToday.current) {
      if (selectedDate === prevToday.current) setSelectedDate(today);
      prevToday.current = today;
    }
  }, [today]);

  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [activeSlot, setActiveSlot] = useState<SlotEntry | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const isPastDate = selectedDate < today;
  const isFutureDate = selectedDate > today;
  const isToday = selectedDate === today;

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? "");
  const { data: rosterConfig, isLoading: isLoadingConfig } =
    useLeagueRosterConfig(leagueId ?? "");

  const { data: rosterPlayers, isLoading: isLoadingRoster, isError: isRosterError, refetch: refetchRoster } = useQuery<
    RosterPlayer[]
  >({
    queryKey: ["teamRoster", teamId, selectedDate],
    queryFn: () => fetchTeamRosterForDate(teamId!, leagueId!, selectedDate),
    enabled: !!teamId && !!leagueId,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  // For past dates: fetch that day's actual game stats
  const { data: dayGameStats } = useQuery<Map<string, DayGameStats>>({
    queryKey: ["dayGameStats", teamId, selectedDate],
    queryFn: async () => {
      const playerIds = rosterPlayers!.map((p) => p.player_id);
      const { data } = await supabase
        .from("player_games")
        .select('player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", ftm, fta, pf, matchup')
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
  const { data: daySchedule } = useQuery<Map<string, string>>({
    queryKey: ["daySchedule", selectedDate],
    queryFn: () => fetchNbaScheduleForDate(selectedDate),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  // Live stats for today via Realtime
  const playerIds = rosterPlayers?.map((p) => p.player_id) ?? [];
  const liveMap = useLivePlayerStats(playerIds, isToday);

  // Game start times for locking slots
  const gameTimeMap = useTodayGameTimes(isToday);

  // Prefetch adjacent days to reduce pop-in when navigating
  useEffect(() => {
    if (!teamId || !leagueId) return;
    const adjacent = [addDays(selectedDate, -1), addDays(selectedDate, 1), addDays(selectedDate, 2)];
    const todayStr = toDateStr(new Date());
    for (const day of adjacent) {
      queryClient.prefetchQuery({
        queryKey: ['teamRoster', teamId, day],
        queryFn: () => fetchTeamRosterForDate(teamId, leagueId, day),
        staleTime: 1000 * 60 * 2,
      });
      if (day >= todayStr) {
        queryClient.prefetchQuery({
          queryKey: ['daySchedule', day],
          queryFn: () => fetchNbaScheduleForDate(day),
          staleTime: 1000 * 60 * 60,
        });
      }
    }
  }, [selectedDate, teamId, leagueId]);

  const isPlayerLocked = (player: RosterPlayer | null): boolean => {
    if (!isToday || !player) return false;
    const liveStatus = liveMap.get(player.player_id)?.game_status;
    return isGameStarted(player.nbaTricode, gameTimeMap, liveStatus);
  };

  const isLoading = isLoadingConfig || isLoadingRoster;

  // ─── Build slot entries ───────────────────────────────────────────────────

  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];
  const irSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((c) => c.position === "BE");
    const irConfig = rosterConfig.find((c) => c.position === "IR");
    const activeConfigs = rosterConfig.filter(
      (c) => c.position !== "BE" && c.position !== "IR",
    );

    for (const config of activeConfigs) {
      const playersInSlot = rosterPlayers.filter(
        (p) => p.roster_slot === config.position,
      );
      for (let i = 0; i < config.slot_count; i++) {
        slots.push({
          slotPosition: config.position,
          slotIndex: i,
          player: playersInSlot[i] ?? null,
        });
      }
    }

    const validActiveSlots = new Set(activeConfigs.map((c) => c.position));
    for (const player of rosterPlayers) {
      if (player.roster_slot === "IR") continue;
      if (
        !player.roster_slot ||
        player.roster_slot === "BE" ||
        !validActiveSlots.has(player.roster_slot)
      ) {
        benchPlayers.push(player);
        continue;
      }
      const config = activeConfigs.find(
        (c) => c.position === player.roster_slot,
      );
      if (config) {
        const playersInSlot = rosterPlayers.filter(
          (p) => p.roster_slot === config.position,
        );
        const idx = playersInSlot.indexOf(player);
        if (idx >= config.slot_count) {
          benchPlayers.push(player);
        }
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
      const irPlayers = rosterPlayers.filter((p) => p.roster_slot === "IR");
      const irSlotCount = Math.max(irConfig.slot_count, irPlayers.length);
      for (let i = 0; i < irSlotCount; i++) {
        irSlots.push({
          slotPosition: "IR",
          slotIndex: i,
          player: irPlayers[i] ?? null,
        });
      }
    }
  }

  // ─── Slot assignment logic ────────────────────────────────────────────────

  const getEligiblePlayersForSlot = (slotPosition: string): RosterPlayer[] => {
    if (!rosterPlayers) return [];
    const isIRSlot = slotPosition === "IR";
    const isBenchSlot = slotPosition === "BE";

    return rosterPlayers.filter((p) => {
      if (activeSlot?.player?.player_id === p.player_id) return false;
      if (isIRSlot) return (p.status === "OUT" || p.status === "SUSP") && p.roster_slot !== "IR";
      if (isBenchSlot) {
        const isOnBench = !p.roster_slot || p.roster_slot === "BE";
        return !isOnBench;
      }
      if (!isEligibleForSlot(p.position, slotPosition)) return false;
      const isOnBench = !p.roster_slot || p.roster_slot === "BE";
      return isOnBench;
    });
  };

  const upsertDailySlot = async (playerId: string, slot: string) => {
    const { error } = await supabase.from("daily_lineups").upsert(
      {
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        lineup_date: selectedDate,
        roster_slot: slot,
      },
      { onConflict: "team_id,player_id,lineup_date" },
    );
    if (error) throw error;
  };

  const handleAssignPlayer = async (player: RosterPlayer) => {
    if (!activeSlot || !teamId || !leagueId || isPastDate) return;

    setIsAssigning(true);
    try {
      const isIRSlot = activeSlot.slotPosition === "IR";
      const isBenchSlot = activeSlot.slotPosition === "BE";
      const selectedIsOnIR = player.roster_slot === "IR";
      const selectedIsStarter =
        player.roster_slot && player.roster_slot !== "BE" && !selectedIsOnIR;

      if (isIRSlot) {
        if (activeSlot.player) {
          await upsertDailySlot(activeSlot.player.player_id, "BE");
        }
        await upsertDailySlot(player.player_id, "IR");
      } else if (isBenchSlot && selectedIsOnIR) {
        await upsertDailySlot(player.player_id, "BE");
      } else if (isBenchSlot && selectedIsStarter && activeSlot.player) {
        const starterSlot = player.roster_slot!;
        const benchPlayerEligible = isEligibleForSlot(
          activeSlot.player.position,
          starterSlot,
        );
        await upsertDailySlot(player.player_id, "BE");
        if (benchPlayerEligible) {
          await upsertDailySlot(activeSlot.player.player_id, starterSlot);
        }
      } else {
        if (activeSlot.player) {
          await upsertDailySlot(activeSlot.player.player_id, "BE");
        }
        await upsertDailySlot(player.player_id, activeSlot.slotPosition);
      }

      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId, selectedDate] });
      setActiveSlot(null);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to assign player");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleClearSlot = async () => {
    if (!activeSlot?.player || !teamId || !leagueId || isPastDate) return;

    setIsAssigning(true);
    try {
      await upsertDailySlot(activeSlot.player.player_id, "BE");
      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId, selectedDate] });
      setActiveSlot(null);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to move player to bench");
    } finally {
      setIsAssigning(false);
    }
  };

  // ─── FPTS / stat resolution per player ───────────────────────────────────

  // Returns { fpts, projFpts, statLine, isLive, matchup } for display in a slot row.
  // fpts === null means no game on that date — show "—" and exclude from totals.
  // projFpts is only set for today's not-yet-started games (shown in sub-line).
  function resolveSlotStats(player: RosterPlayer | null): {
    fpts: number | null;
    projFpts: number | null;
    statLine: string | null;
    isLive: boolean;
    matchup: string | null;
  } {
    if (!player || !scoringWeights) return { fpts: null, projFpts: null, statLine: null, isLive: false, matchup: null };

    if (isToday) {
      const live = liveMap.get(player.player_id);
      if (live) {
        const stats = liveToStatRecord(live);
        const fpts = Math.round(calculateGameFantasyPoints(stats as any, scoringWeights) * 10) / 10;
        return {
          fpts,
          projFpts: null,
          statLine: live.game_status === 1 ? null : buildStatLine(stats),
          isLive: live.game_status === 2,
          matchup: live.matchup || null,
        };
      }
      // No live entry — game may be scheduled but not started yet; show 0.0 as actual, proj in sub-line
      const todayMatchup = player.nbaTricode ? (daySchedule?.get(player.nbaTricode) ?? null) : null;
      if (todayMatchup) {
        return {
          fpts: 0,
          projFpts: calculateAvgFantasyPoints(player, scoringWeights),
          statLine: null,
          isLive: false,
          matchup: todayMatchup,
        };
      }
      return { fpts: null, projFpts: null, statLine: null, isLive: false, matchup: null };
    }

    if (isPastDate) {
      const dayGame = dayGameStats?.get(player.player_id);
      if (dayGame) {
        const stats = dayToStatRecord(dayGame);
        const fpts = Math.round(calculateGameFantasyPoints(stats as any, scoringWeights) * 10) / 10;
        return { fpts, projFpts: null, statLine: buildStatLine(stats), isLive: false, matchup: dayGame.matchup ?? null };
      }
      // No game that day — show "—", not avg
      return { fpts: null, projFpts: null, statLine: null, isLive: false, matchup: null };
    }

    // Future — only show projection if player has a game that day
    const futureMatchup = player.nbaTricode ? (daySchedule?.get(player.nbaTricode) ?? null) : null;
    if (!futureMatchup) {
      return { fpts: null, projFpts: null, statLine: null, isLive: false, matchup: null };
    }
    return {
      fpts: calculateAvgFantasyPoints(player, scoringWeights),
      projFpts: null,
      statLine: null,
      isLive: false,
      matchup: futureMatchup,
    };
  }

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
        <ErrorState message="Failed to load roster" onRetry={() => refetchRoster()} />
      </SafeAreaView>
    );
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <View style={styles.centered}>
          <ThemedText style={{ color: c.secondaryText }}>
            No players on your roster yet.
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  const starterSlots = slots.filter((s) => s.slotPosition !== "BE");
  const benchSlots = slots.filter((s) => s.slotPosition === "BE");

  const starterTotal = scoringWeights
    ? starterSlots.reduce((sum, slot) => {
        if (!slot.player) return sum;
        const { fpts, isLive } = resolveSlotStats(slot.player);
        // For today, only count games that are actually live or finished (not pre-game 0.0)
        if (isToday && !isLive && fpts !== null) {
          const live = liveMap.get(slot.player.player_id);
          // Only include if there's actual live data (game started/finished)
          if (!live) return sum;
        }
        return fpts !== null ? sum + fpts : sum;
      }, 0)
    : null;

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const { fpts, projFpts, statLine, isLive, matchup } = resolveSlotStats(slot.player);
    const liveData = slot.player ? liveMap.get(slot.player.player_id) : null;
    const gameInfo = liveData ? formatGameInfo(liveData) : '';
    const locked = isPlayerLocked(slot.player);

    const isActive =
      activeSlot?.slotPosition === slot.slotPosition &&
      activeSlot?.slotIndex === slot.slotIndex;

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
            locked && { opacity: 0.6 },
          ]}
          onPress={() => !isPastDate && !locked && setActiveSlot(slot)}
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
            {SLOT_LABELS[slot.slotPosition] ?? slot.slotPosition}
          </ThemedText>
        </TouchableOpacity>

        {slot.player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(slot.player)}
            onLongPress={() => {
              if (isPastDate || locked) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveSlot(slot);
            }}
            delayLongPress={400}
          >
            {/* Headshot with team pill + on-court dot */}
            <View style={styles.rosterPortraitWrap}>
              {(() => {
                const url = getPlayerHeadshotUrl(slot.player.external_id_nba);
                return url ? (
                  <Image source={{ uri: url }} style={styles.rosterHeadshot} resizeMode="cover" />
                ) : (
                  <View style={[styles.rosterHeadshot, { backgroundColor: c.border }]} />
                );
              })()}
              {liveData?.oncourt && <View style={styles.onCourtDot} />}
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.nba_team);
                return (
                  <View style={styles.rosterTeamPill}>
                    {logoUrl && (
                      <Image source={{ uri: logoUrl }} style={styles.rosterTeamPillLogo} resizeMode="contain" />
                    )}
                    <Text style={styles.rosterTeamPillText}>{slot.player.nba_team}</Text>
                  </View>
                );
              })()}
            </View>
            <View style={styles.slotPlayerInfo}>
              {/* Line 1: ● Name | badges */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", flexShrink: 1 }}>
                <ThemedText
                  type="defaultSemiBold"
                  style={[styles.slotPlayerName]}
                >
                  {slot.player.name}
                </ThemedText>
                {matchup && (
                  <View style={[styles.matchupChip, { backgroundColor: c.cardAlt }]}>
                    <Text style={[styles.matchupChipText, { color: c.secondaryText }]}>{matchup}</Text>
                  </View>
                )}
                {(() => {
                  const badge = getInjuryBadge(slot.player.status);
                  return badge ? (
                    <View style={[styles.liveBadge, { backgroundColor: badge.color }]}>
                      <Text style={styles.liveText}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
                {isLive && (
                  <View style={[styles.liveBadge, { backgroundColor: "#e03131" }]}>
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                )}
                {locked && !isLive && (
                  <View style={[styles.liveBadge, { backgroundColor: '#868e96' }]}>
                    <Text style={styles.liveText}>LOCKED</Text>
                  </View>
                )}
              </View>
              {/* Line 2: context-dependent sub-line */}
              {(isFutureDate || (isToday && !isLive && !statLine && matchup)) ? (
                <ThemedText
                  style={[styles.slotPlayerSub, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {formatPosition(slot.player.position)}{(projFpts ?? (isFutureDate ? fpts : null)) !== null ? ` · proj: ${(projFpts ?? fpts)!.toFixed(1)}` : ''}
                </ThemedText>
              ) : (gameInfo || statLine) ? (
                <ThemedText
                  style={[styles.slotPlayerSub, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {[gameInfo, statLine].filter(Boolean).join(' · ')}
                </ThemedText>
              ) : null}
            </View>
            <AnimatedFpts
              value={fpts}
              accentColor={c.accent}
              dimColor={c.secondaryText}
              textStyle={styles.slotFpts}
            />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => !isPastDate && setActiveSlot(slot)}
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
        <View style={styles.navLeft}>
          <TouchableOpacity
            onPress={() => setSelectedDate(addDays(selectedDate, -1))}
            style={styles.navArrow}
          >
            <Text style={[styles.navArrowText, { color: c.text }]}>‹</Text>
          </TouchableOpacity>
          {selectedDate !== today && (
            <TouchableOpacity onPress={() => setSelectedDate(today)}>
              <ThemedText style={[styles.todayChipText, { color: c.accent }]}>
                Today
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.dayInfo}>
          <View>
            <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
              {formatDayLabel(selectedDate)}
            </ThemedText>
          </View>
          {isPastDate && (
            <ThemedText style={[styles.daySubLabel, { color: c.secondaryText }]}>
              Past lineup (read-only)
            </ThemedText>
          )}
          {isToday && (
            <ThemedText style={[styles.daySubLabel, { color: c.secondaryText }]}>
              Today's lineup
            </ThemedText>
          )}
          {isFutureDate && (
            <ThemedText style={[styles.daySubLabel, { color: c.secondaryText }]}>
              Future lineup
            </ThemedText>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setSelectedDate(addDays(selectedDate, 1))}
          style={styles.navArrow}
        >
          <Text style={[styles.navArrowText, { color: c.text }]}>›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Starters</ThemedText>
            {starterTotal !== null && (
              <View
                style={[
                  styles.totalBadge,
                  {
                    backgroundColor: c.activeCard,
                    borderColor: c.activeBorder,
                  },
                ]}
              >
                <ThemedText
                  style={[styles.totalLabel, { color: c.secondaryText }]}
                >
                  {isPastDate ? "FPTS" : isToday ? "LIVE FPTS" : "PROJ FPTS"}
                </ThemedText>
                <ThemedText
                  style={[styles.totalValue, { color: c.activeText }]}
                >
                  {starterTotal.toFixed(1)}
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
            <ThemedText type="subtitle">Bench</ThemedText>
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
              <ThemedText type="subtitle">Injured Reserve</ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: c.card }]}>
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Slot Picker Modal */}
      {!isPastDate && (
        <SlotPickerModal
          visible={!!activeSlot}
          slot={activeSlot}
          eligiblePlayers={
            activeSlot
              ? getEligiblePlayersForSlot(activeSlot.slotPosition).filter(p => !isPlayerLocked(p))
              : []
          }
          scoringWeights={scoringWeights}
          isAssigning={isAssigning}
          seatLocked={!!activeSlot?.player && isPlayerLocked(activeSlot.player)}
          daySchedule={daySchedule}
          onSelectPlayer={handleAssignPlayer}
          onClear={handleClearSlot}
          onClose={() => setActiveSlot(null)}
        />
      )}

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ""}
        teamId={teamId ?? undefined}
        onClose={() => setSelectedPlayer(null)}
      />
    </SafeAreaView>
  );
}

// ─── Slot Picker Modal ────────────────────────────────────────────────────────

interface SlotPickerModalProps {
  visible: boolean;
  slot: SlotEntry | null;
  eligiblePlayers: RosterPlayer[];
  scoringWeights: any;
  isAssigning: boolean;
  seatLocked?: boolean;
  daySchedule: Map<string, string> | undefined;
  onSelectPlayer: (player: RosterPlayer) => void;
  onClear: () => void;
  onClose: () => void;
}

function SlotPickerModal({
  visible,
  slot,
  eligiblePlayers,
  scoringWeights,
  isAssigning,
  seatLocked,
  daySchedule,
  onSelectPlayer,
  onClear,
  onClose,
}: SlotPickerModalProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80 || gestureState.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: 500,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            onCloseRef.current();
            translateY.setValue(0);
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    }),
  ).current;

  if (!slot) return null;

  const label = SLOT_LABELS[slot.slotPosition] ?? slot.slotPosition;
  const listData = eligiblePlayers.filter(
    (p) => p.player_id !== slot.player?.player_id,
  );
  const isStarterSlot = slot.slotPosition !== "BE" && slot.slotPosition !== "IR";

  const hasGame = (player: RosterPlayer) =>
    player.nbaTricode ? !!daySchedule?.get(player.nbaTricode) : false;

  const playerFpts = (player: RosterPlayer): number | null => {
    if (!scoringWeights) return null;
    if (!hasGame(player)) return 0;
    return calculateAvgFantasyPoints(player, scoringWeights);
  };

  const currentFpts =
    isStarterSlot && slot.player
      ? playerFpts(slot.player)
      : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.pickerOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <Animated.View
          style={[
            styles.pickerSheet,
            { backgroundColor: c.background, transform: [{ translateY }] },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={[styles.pickerHeader, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText type="defaultSemiBold" style={{ fontSize: 17 }}>
                {label} Slot
              </ThemedText>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <ThemedText style={{ fontSize: 16 }}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isAssigning ? (
            <ActivityIndicator style={{ padding: 20 }} />
          ) : (
            <ScrollView style={styles.pickerScroll} bounces={false}>
              {slot.player && (
                <View
                  style={[
                    styles.currentPlayerRow,
                    {
                      borderBottomColor: c.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText type="defaultSemiBold">
                      {slot.player.name}
                    </ThemedText>
                    <ThemedText
                      style={{ color: c.secondaryText, fontSize: 12 }}
                    >
                      {formatPosition(slot.player.position)} ·{" "}
                      {slot.player.nba_team}
                    </ThemedText>
                  </View>
                  {(isStarterSlot || slot.slotPosition === "IR") && !seatLocked && (
                    <TouchableOpacity
                      style={[styles.clearButton, { borderColor: c.border }]}
                      onPress={onClear}
                    >
                      <ThemedText
                        style={{
                          color: "#dc3545",
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {slot.slotPosition === "IR" ? "Activate" : "Bench"}
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {listData.length === 0 && !slot.player && (
                <View style={{ padding: 20, alignItems: "center" }}>
                  <ThemedText style={{ color: c.secondaryText }}>
                    {slot.slotPosition === "IR"
                      ? "No players with OUT designation on your roster"
                      : "No eligible players available"}
                  </ThemedText>
                </View>
              )}
              {listData.map((item, idx) => {
                const fpts = playerFpts(item);
                const diff =
                  fpts !== null && currentFpts !== null
                    ? fpts - currentFpts
                    : null;

                return (
                  <TouchableOpacity
                    key={item.player_id}
                    style={[
                      styles.pickerRow,
                      idx < listData.length - 1 && {
                        borderBottomColor: c.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    onPress={() => onSelectPlayer(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {item.name}
                        </ThemedText>
                        {(() => {
                          const badge = getInjuryBadge(item.status);
                          return badge ? (
                            <View style={[styles.liveBadge, { backgroundColor: badge.color }]}>
                              <Text style={styles.liveText}>{badge.label}</Text>
                            </View>
                          ) : null;
                        })()}
                      </View>
                      <ThemedText
                        style={{ color: c.secondaryText, fontSize: 12 }}
                      >
                        {formatPosition(item.position)} · {item.nba_team}
                      </ThemedText>
                    </View>
                    {fpts !== null && (
                      <View style={{ alignItems: "flex-end" }}>
                        <ThemedText
                          style={{
                            color: c.accent,
                            fontWeight: "600",
                            fontSize: 14,
                          }}
                        >
                          {fpts} FPTS
                        </ThemedText>
                        {diff !== null && (
                          <ThemedText
                            style={{
                              fontSize: 11,
                              fontWeight: "600",
                              marginTop: 1,
                              color:
                                diff > 0
                                  ? "#28a745"
                                  : diff < 0
                                    ? "#dc3545"
                                    : c.secondaryText,
                            }}
                          >
                            ({diff > 0 ? "+" : ""}
                            {diff.toFixed(1)})
                          </ThemedText>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  navLeft: { flexDirection: "row", alignItems: "center" },
  navArrow: { padding: 12 },
  navArrowText: { fontSize: 28, lineHeight: 32 },
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  totalLabel: { fontSize: 10, fontWeight: "600" },
  totalValue: { fontSize: 16, fontWeight: "700" },
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
    width: 44,
    height: 36,
    marginRight: 8,
  },
  onCourtDot: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#2dc653",
    zIndex: 1,
  },
  rosterHeadshot: {
    width: 44,
    height: 32,
    borderRadius: 4,
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
    color: "#fff",
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
  matchupChipText: {
    fontSize: 9,
    fontWeight: '600' as const,
  },
  liveBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  liveText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: { padding: 8, marginTop: -4, marginRight: -4 },
  currentPlayerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  pickerOverlay: { flex: 1, justifyContent: "flex-end" },
  pickerSheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: "70%",
    overflow: "hidden",
    paddingBottom: 32,
  },
  pickerScroll: { flexGrow: 0 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
});
