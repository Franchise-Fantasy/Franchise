import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryScoreboard } from "@/components/matchup/CategoryScoreboard";
import {
  MatchupPillBar,
  type PillMatchup,
} from "@/components/matchup/MatchupPillBar";
import { SkeletonBlock } from "@/components/matchup/MatchupSkeleton";
import {
  colStyles,
  styles,
} from "@/components/matchup/matchupStyles";
import {
  buildStatLine,
  DisplayMode,
  PlayerCell,
  pStyles,
  RosterPlayer,
  round1,
} from "@/components/matchup/PlayerCell";
import { WeeklySummaryModal } from "@/components/matchup/WeeklySummaryModal";
import { WeekScheduleModal } from "@/components/matchup/WeekScheduleModal";
import { FptsBreakdownModal } from "@/components/player/FptsBreakdownModal";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { TeamLogo } from "@/components/team/TeamLogo";
import { ErrorState } from "@/components/ui/ErrorState";
import { InfoModal } from "@/components/ui/InfoModal";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
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
import {
  RosterConfigSlot,
  useLeagueRosterConfig,
} from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLiveActivity } from "@/hooks/useLiveActivity";
import { useRosterChanges } from "@/hooks/useRosterChanges";
import { useWeekScores } from "@/hooks/useWeekScores";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats, ScoringWeight } from "@/types/player";
import {
  addDays,
  formatDayLabel,
  parseLocalDate,
  toDateStr,
  useToday,
} from "@/utils/dates";
import {
  LivePlayerStats,
  liveToGameLog,
  useLivePlayerStats,
} from "@/utils/nba/nbaLive";
import { fetchNbaScheduleForDate } from "@/utils/nba/nbaSchedule";
import { fetchTeamData } from "@/utils/roster/fetchTeamData";
import { slotLabel } from "@/utils/roster/rosterSlots";
import { s } from "@/utils/scale";
import {
  aggregateTeamStats,
  computeCategoryResults,
  TeamStatTotals,
} from "@/utils/scoring/categoryScoring";
import { calculateGameFantasyPoints, formatScore } from "@/utils/scoring/fantasyPoints";


// ─── Types ───────────────────────────────────────────────────────────────────

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

interface Matchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  playoff_round: number | null;
  is_finalized: boolean;
  home_player_scores: StoredPlayerScore[] | null;
  away_player_scores: StoredPlayerScore[] | null;
}

interface StoredPlayerScore {
  player_id: string;
  name: string;
  position: string;
  pro_team: string;
  external_id_nba: number | null;
  roster_slot: string;
  week_points: number;
  games: {
    date: string;
    slot: string;
    fpts: number;
    stats: Record<string, any>;
    matchup: string | null;
  }[];
}

interface TeamMatchupData {
  teamId: string;
  teamName: string;
  logoKey: string | null;
  players: RosterPlayer[];
  weekTotal: number;
  dayTotal: number;
  teamStats: TeamStatTotals;
}

interface MatchupSlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

// Build a fixed-length array of slot entries from the roster config, mapping players into their slots.
// Empty slots show as null. This ensures both teams always display the same number of rows.
function buildMatchupSlots(
  players: RosterPlayer[],
  config: RosterConfigSlot[],
): MatchupSlotEntry[] {
  const activeConfigs = config.filter(
    (c) => c.position !== "BE" && c.position !== "IR",
  );
  const slots: MatchupSlotEntry[] = [];
  // Track placed players so duplicate-slot collisions fall to bench
  const placedPlayerIds = new Set<string>();

  for (const cfg of activeConfigs) {
    if (cfg.position === "UTIL") {
      for (let i = 0; i < cfg.slot_count; i++) {
        const numberedSlot = `UTIL${i + 1}`;
        const player =
          players.find((p) => p.roster_slot === numberedSlot && !placedPlayerIds.has(p.player_id)) ?? null;
        if (player) placedPlayerIds.add(player.player_id);
        slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
      }
    } else {
      const inSlot = players.filter((p) => p.roster_slot === cfg.position && !placedPlayerIds.has(p.player_id));
      for (let i = 0; i < cfg.slot_count; i++) {
        const player = inSlot[i] ?? null;
        if (player) placedPlayerIds.add(player.player_id);
        slots.push({
          slotPosition: cfg.position,
          slotIndex: i,
          player,
        });
      }
    }
  }
  return slots;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchWeeks(leagueId: string): Promise<Week[]> {
  const { data, error } = await supabase
    .from("league_schedule")
    .select("id, week_number, start_date, end_date, is_playoff")
    .eq("league_id", leagueId)
    .order("week_number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchMatchupForWeek(
  scheduleId: string,
  teamId: string,
): Promise<Matchup | null> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select(
      "id, home_team_id, away_team_id, home_score, away_score, playoff_round, is_finalized, home_player_scores, away_player_scores",
    )
    .eq("schedule_id", scheduleId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (error) throw error;
  return data as Matchup | null;
}

async function fetchTeamInfo(teamId: string): Promise<{ name: string; logoKey: string | null }> {
  const { data } = await supabase
    .from("teams")
    .select("name, logo_key")
    .eq("id", teamId)
    .single();
  return { name: data?.name ?? "Unknown Team", logoKey: data?.logo_key ?? null };
}

async function fetchAllWeekMatchups(
  scheduleId: string,
): Promise<PillMatchup[]> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select("id, home_team_id, away_team_id")
    .eq("schedule_id", scheduleId);
  if (error) throw error;
  return data ?? [];
}

async function fetchWeeklyAdds(
  leagueId: string,
  teamId: string,
): Promise<number> {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const weekStart = monday.toISOString().split("T")[0];

  const { count, error } = await supabase
    .from("league_transactions")
    .select("id, league_transaction_items!inner(team_to_id)", {
      count: "exact",
      head: true,
    })
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("type", "waiver")
    .not("league_transaction_items.team_to_id", "is", null)
    .gte("created_at", weekStart + "T00:00:00");
  if (error) throw error;
  return count ?? 0;
}

// Fetch seeds for a specific team in the current playoff round
async function fetchTeamSeeds(
  leagueId: string,
  season: string,
  round: number,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("playoff_bracket")
    .select("team_a_id, team_a_seed, team_b_id, team_b_seed")
    .eq("league_id", leagueId)
    .eq("season", season)
    .eq("round", round);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.team_a_id && row.team_a_seed)
      map.set(row.team_a_id, row.team_a_seed);
    if (row.team_b_id && row.team_b_seed)
      map.set(row.team_b_id, row.team_b_seed);
  }
  return map;
}

function buildFromStored(
  stored: StoredPlayerScore[],
  selectedDate: string,
  scoring: ScoringWeight[],
): { players: RosterPlayer[]; teamStats: TeamStatTotals } {
  const activeGames: Record<string, any>[] = [];
  const weekStatsPerPlayer = new Map<string, Record<string, number>>();

  const players: RosterPlayer[] = stored.map((p) => {
    const dayGame = p.games.find((g) => g.date === selectedDate);
    const sorted = [...p.games].sort((a, b) => b.date.localeCompare(a.date));
    const closestEntry = sorted.find((g) => g.date <= selectedDate);
    const daySlot = closestEntry?.slot ?? p.roster_slot;
    const isDayActive =
      daySlot !== "BE" && daySlot !== "IR" && daySlot !== "DROPPED";

    for (const g of p.games) {
      if (g.slot !== "BE" && g.slot !== "IR" && g.slot !== "DROPPED") {
        activeGames.push(g.stats);
        // Accumulate per-player weekly stat totals
        const existing = weekStatsPerPlayer.get(p.player_id) ?? {};
        for (const [key, val] of Object.entries(g.stats)) {
          if (val != null) {
            const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
            existing[key] = (existing[key] ?? 0) + numVal;
          }
        }
        weekStatsPerPlayer.set(p.player_id, existing);
      }
    }

    const t = p.pro_team ?? "";
    return {
      player_id: p.player_id,
      name: p.name,
      position: p.position,
      pro_team: t,
      nbaTricode: t && t !== "Active" && t !== "Inactive" ? t : null,
      external_id_nba: p.external_id_nba,
      status: "active",
      roster_slot: daySlot,
      weekPoints: round1(p.week_points),
      dayPoints: isDayActive && dayGame ? round1(dayGame.fpts) : 0,
      dayMatchup: isDayActive && dayGame ? dayGame.matchup : null,
      dayStatLine:
        isDayActive && dayGame ? buildStatLine(dayGame.stats, scoring) : null,
      dayGameStats: isDayActive && dayGame ? dayGame.stats : null,
      projectedFpts: 0,
      weekGameStats: weekStatsPerPlayer.get(p.player_id) ?? null,
    };
  });

  return { players, teamStats: aggregateTeamStats(activeGames) };
}

async function fetchWeekMatchupData(
  week: Week,
  teamId: string,
  leagueId: string,
  selectedDate: string,
  scoring: ScoringWeight[],
): Promise<{
  myTeam: TeamMatchupData;
  opponentTeam: TeamMatchupData | null;
  week: Week;
} | null> {
  const matchup = await fetchMatchupForWeek(week.id, teamId);
  if (!matchup) return null;

  const isHome = matchup.home_team_id === teamId;
  const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;
  const useStored = matchup.is_finalized && matchup.home_player_scores;

  if (useStored) {
    const myStored = isHome
      ? matchup.home_player_scores!
      : matchup.away_player_scores!;
    const oppStored = isHome
      ? matchup.away_player_scores
      : matchup.home_player_scores;

    const [myInfo, oppInfo] = await Promise.all([
      fetchTeamInfo(teamId),
      opponentId ? fetchTeamInfo(opponentId) : Promise.resolve(null),
    ]);

    const myResult = buildFromStored(myStored, selectedDate, scoring);
    const myTeam: TeamMatchupData = {
      teamId,
      teamName: myInfo.name,
      logoKey: myInfo.logoKey,
      players: myResult.players,
      weekTotal: round1(myResult.players.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(myResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: myResult.teamStats,
    };

    let opponentTeam: TeamMatchupData | null = null;
    if (opponentId && oppStored && oppInfo) {
      const oppResult = buildFromStored(oppStored, selectedDate, scoring);
      opponentTeam = {
        teamId: opponentId,
        teamName: oppInfo.name,
        logoKey: oppInfo.logoKey,
        players: oppResult.players,
        weekTotal: round1(
          oppResult.players.reduce((s, p) => s + p.weekPoints, 0),
        ),
        dayTotal: round1(
          oppResult.players.reduce((s, p) => s + p.dayPoints, 0),
        ),
        teamStats: oppResult.teamStats,
      };
    }

    return { myTeam, opponentTeam, week };
  }

  // Live reconstruction for current/unfinalized weeks — fetch both teams in parallel
  const [myResult, myInfo, oppResult, oppInfo] = await Promise.all([
    fetchTeamData(teamId, leagueId, week, selectedDate, scoring),
    fetchTeamInfo(teamId),
    opponentId
      ? fetchTeamData(opponentId, leagueId, week, selectedDate, scoring)
      : Promise.resolve(null),
    opponentId ? fetchTeamInfo(opponentId) : Promise.resolve(null),
  ]);

  let opponentTeam: TeamMatchupData | null = null;
  if (opponentId && oppResult && oppInfo) {
    opponentTeam = {
      teamId: opponentId,
      teamName: oppInfo.name,
      logoKey: oppInfo.logoKey,
      players: oppResult.players,
      weekTotal: oppResult.weekTotalAll ?? round1(
        oppResult.players.reduce((s, p) => s + p.weekPoints, 0),
      ),
      dayTotal: round1(oppResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: oppResult.teamStats,
    };
  }

  return {
    myTeam: {
      teamId,
      teamName: myInfo.name,
      logoKey: myInfo.logoKey,
      players: myResult.players,
      weekTotal: myResult.weekTotalAll ?? round1(myResult.players.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(myResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: myResult.teamStats,
    },
    opponentTeam,
    week,
  };
}

async function fetchMatchupDataById(
  matchupId: string,
  week: Week,
  leagueId: string,
  selectedDate: string,
  scoring: ScoringWeight[],
): Promise<{ homeTeam: TeamMatchupData; awayTeam: TeamMatchupData | null }> {
  const { data: matchup, error } = await supabase
    .from("league_matchups")
    .select(
      "id, home_team_id, away_team_id, is_finalized, home_player_scores, away_player_scores",
    )
    .eq("id", matchupId)
    .single();
  if (error) throw error;

  const [homeInfo, awayInfo] = await Promise.all([
    fetchTeamInfo(matchup.home_team_id),
    matchup.away_team_id
      ? fetchTeamInfo(matchup.away_team_id)
      : Promise.resolve(null),
  ]);

  const useStored = matchup.is_finalized && matchup.home_player_scores;

  if (useStored) {
    const homeResult = buildFromStored(
      matchup.home_player_scores as unknown as StoredPlayerScore[],
      selectedDate,
      scoring,
    );
    const homeTeam: TeamMatchupData = {
      teamId: matchup.home_team_id,
      teamName: homeInfo.name,
      logoKey: homeInfo.logoKey,
      players: homeResult.players,
      weekTotal: round1(
        homeResult.players.reduce((s, p) => s + p.weekPoints, 0),
      ),
      dayTotal: round1(homeResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: homeResult.teamStats,
    };

    let awayTeam: TeamMatchupData | null = null;
    if (matchup.away_team_id && awayInfo && matchup.away_player_scores) {
      const awayResult = buildFromStored(
        matchup.away_player_scores as unknown as StoredPlayerScore[],
        selectedDate,
        scoring,
      );
      awayTeam = {
        teamId: matchup.away_team_id,
        teamName: awayInfo.name,
        logoKey: awayInfo.logoKey,
        players: awayResult.players,
        weekTotal: round1(
          awayResult.players.reduce((s, p) => s + p.weekPoints, 0),
        ),
        dayTotal: round1(
          awayResult.players.reduce((s, p) => s + p.dayPoints, 0),
        ),
        teamStats: awayResult.teamStats,
      };
    }

    return { homeTeam, awayTeam };
  }

  // Live reconstruction
  const [homeResult, awayResult] = await Promise.all([
    fetchTeamData(matchup.home_team_id, leagueId, week, selectedDate, scoring),
    matchup.away_team_id
      ? fetchTeamData(
          matchup.away_team_id,
          leagueId,
          week,
          selectedDate,
          scoring,
        )
      : Promise.resolve(null),
  ]);

  const homeTeam: TeamMatchupData = {
    teamId: matchup.home_team_id,
    teamName: homeInfo.name,
    logoKey: homeInfo.logoKey,
    players: homeResult.players,
    weekTotal: homeResult.weekTotalAll ?? round1(homeResult.players.reduce((s, p) => s + p.weekPoints, 0)),
    dayTotal: round1(homeResult.players.reduce((s, p) => s + p.dayPoints, 0)),
    teamStats: homeResult.teamStats,
  };

  let awayTeam: TeamMatchupData | null = null;
  if (matchup.away_team_id && awayInfo && awayResult) {
    awayTeam = {
      teamId: matchup.away_team_id,
      teamName: awayInfo.name,
      logoKey: awayInfo.logoKey,
      players: awayResult.players,
      weekTotal: awayResult.weekTotalAll ?? round1(
        awayResult.players.reduce((s, p) => s + p.weekPoints, 0),
      ),
      dayTotal: round1(awayResult.players.reduce((s, p) => s + p.dayPoints, 0)),
      teamStats: awayResult.teamStats,
    };
  }

  return { homeTeam, awayTeam };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: queryKeys.leagueSchedule(leagueId!),
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

function useWeekMatchup(
  weeks: Week[] | undefined,
  selectedDate: string,
  teamId: string | null,
  leagueId: string | null,
  scoring: ScoringWeight[],
) {
  const week =
    weeks?.find(
      (w) => w.start_date <= selectedDate && selectedDate <= w.end_date,
    ) ?? null;

  return useQuery({
    queryKey: queryKeys.weekMatchup(leagueId!, week?.id, teamId ?? undefined, selectedDate),
    queryFn: () => {
      if (!week || !teamId || !leagueId) return null;
      return fetchWeekMatchupData(
        week,
        teamId,
        leagueId,
        selectedDate,
        scoring,
      );
    },
    enabled: !!week && !!teamId && !!leagueId && scoring.length > 0,
    staleTime: 1000 * 60 * 2,
    placeholderData: (prev, prevQuery) => {
      // Only keep previous data when navigating within the same league
      const prevKey = prevQuery?.queryKey as string[] | undefined;
      if (prevKey && prevKey[1] === leagueId) return prev;
      return undefined;
    },
  });
}

// Renders the full matchup: score headers + slot rows with center position labels
function MatchupBoard({
  leftTeam,
  rightTeam,
  leftSlots,
  rightSlots,
  c,
  mode,
  liveMap,
  scoring,
  leftWeekScore,
  rightWeekScore,
  leftDayLiveBonus,
  rightDayLiveBonus,
  futureSchedule,
  seedMap,
  onPlayerPress,
  onFptsPress,
  onSummaryPress,
  onGoLive,
  liveActivityActive,
  scoringType,
  onTeamPress,
}: {
  leftTeam: TeamMatchupData;
  rightTeam: TeamMatchupData | null;
  leftSlots: MatchupSlotEntry[];
  rightSlots: MatchupSlotEntry[];
  c: any;
  mode: DisplayMode;
  liveMap: Map<string, LivePlayerStats>;
  scoring: ScoringWeight[];
  leftWeekScore: number;
  rightWeekScore: number;
  leftDayLiveBonus: number;
  rightDayLiveBonus: number;
  futureSchedule?: Map<string, any>;
  seedMap?: Map<string, number>;
  onPlayerPress?: (playerId: string) => void;
  onFptsPress?: (
    stats: Record<string, number | boolean>,
    playerName: string,
    gameLabel: string,
  ) => void;
  onSummaryPress?: () => void;
  onGoLive?: () => void;
  liveActivityActive?: boolean;
  scoringType?: string;
  onTeamPress?: (teamId: string) => void;
}) {
  const isCategories = scoringType === "h2h_categories";

  // For future mode, compute projected day total from active players' season averages
  const computeProjectedDay = (
    players: RosterPlayer[],
    schedule?: Map<string, any>,
  ) => {
    if (!schedule) return 0;
    return round1(
      players.reduce((sum, p) => {
        if (
          p.roster_slot === "BE" ||
          p.roster_slot === "IR" ||
          p.roster_slot === "DROPPED"
        )
          return sum;
        if (!p.nbaTricode || !schedule.has(p.nbaTricode)) return sum;
        return sum + (p.projectedFpts ?? 0);
      }, 0),
    );
  };

  const leftWeek = leftWeekScore;
  const leftDay =
    mode === "future"
      ? computeProjectedDay(leftTeam.players, futureSchedule)
      : round1(leftTeam.dayTotal + leftDayLiveBonus);
  const rightWeek = rightWeekScore;
  const rightDay =
    mode === "future" && rightTeam
      ? computeProjectedDay(rightTeam.players, futureSchedule)
      : rightTeam
        ? round1(rightTeam.dayTotal + rightDayLiveBonus)
        : 0;

  // Merge live in-progress game stats into a team's DB-based teamStats
  const mergeWithLive = (team: TeamMatchupData): TeamStatTotals => {
    if (liveMap.size === 0) return team.teamStats;
    const merged = { ...team.teamStats };
    for (const p of team.players) {
      if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === 'DROPPED') continue;
      const live = liveMap.get(p.player_id);
      if (!live) continue;
      const gameLog = liveToGameLog(live);
      for (const [key, val] of Object.entries(gameLog)) {
        if (val == null) continue;
        const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
        merged[key] = (merged[key] ?? 0) + numVal;
      }
    }
    return merged;
  };

  // For category leagues, compute live category comparison
  const categoryComparison =
    isCategories && rightTeam
      ? computeCategoryResults(
          mergeWithLive(leftTeam),
          mergeWithLive(rightTeam),
          scoring.map((s) => ({ stat_name: s.stat_name, inverse: s.inverse ?? false })),
        )
      : null;

  // Use the longer slot list (should always be the same length)
  const slotCount = Math.max(leftSlots.length, rightSlots.length);

  return (
    <View>
      {/* Score header */}
      {isCategories && categoryComparison ? (
        <View style={[colStyles.scoreCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <CategoryScoreboard
            results={categoryComparison.results}
            homeWins={categoryComparison.homeWins}
            awayWins={categoryComparison.awayWins}
            ties={categoryComparison.ties}
            homeTeamName={`${seedMap?.has(leftTeam.teamId) ? `#${seedMap.get(leftTeam.teamId)} ` : ""}${leftTeam.teamName}`}
            awayTeamName={
              rightTeam
                ? `${rightTeam.teamName}${seedMap?.has(rightTeam.teamId) ? ` #${seedMap.get(rightTeam.teamId)}` : ""}`
                : "BYE"
            }
          />
        </View>
      ) : (
        <View
          style={[colStyles.scoreCard, { backgroundColor: c.card, borderColor: c.border }]}
        >
        <View
          style={colStyles.scoreHeader}
          accessibilityRole="summary"
          accessibilityLabel={`${leftTeam.teamName} ${formatScore(leftWeek)} versus ${rightTeam ? `${rightTeam.teamName} ${formatScore(rightWeek)}` : "BYE"}`}
        >
          <View style={[colStyles.scoreCol, { alignItems: "flex-start" }]}>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              onPress={() => onTeamPress?.(leftTeam.teamId)}
              activeOpacity={0.6}
              accessibilityRole="link"
              accessibilityLabel={`View ${leftTeam.teamName} roster`}
            >
              <TeamLogo logoKey={leftTeam.logoKey} teamName={leftTeam.teamName} size="small" />
              <Text
                style={[colStyles.teamName, { color: c.text, flexShrink: 1 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                accessibilityRole="header"
              >
                {seedMap?.has(leftTeam.teamId)
                  ? `#${seedMap.get(leftTeam.teamId)} `
                  : ""}
                {leftTeam.teamName}
              </Text>
            </TouchableOpacity>
            <Text style={[colStyles.total, { color: c.accent }]}>
              {formatScore(leftWeek)}
            </Text>
            {mode !== "future" && (
              <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>
                {formatScore(leftDay)} today
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={colStyles.vsCol}
            onPress={onSummaryPress}
            disabled={!onSummaryPress}
            accessibilityRole="button"
            accessibilityLabel="View weekly summary"
          >
            <Text
              style={[colStyles.vsText, { color: c.secondaryText }]}
              accessible={false}
            >
              vs
            </Text>
            {onSummaryPress && (
              <Text style={[colStyles.summaryBtnText, { color: c.accent }]}>
                Summary
              </Text>
            )}
          </TouchableOpacity>
          <View style={[colStyles.scoreCol, { alignItems: "flex-end" }]}>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              onPress={() => rightTeam && onTeamPress?.(rightTeam.teamId)}
              disabled={!rightTeam}
              activeOpacity={0.6}
              accessibilityRole="link"
              accessibilityLabel={rightTeam ? `View ${rightTeam.teamName} roster` : "BYE"}
            >
              <Text
                style={[
                  colStyles.teamName,
                  { color: c.text, textAlign: "right", flexShrink: 1 },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                accessibilityRole="header"
              >
                {rightTeam
                  ? `${rightTeam.teamName}${seedMap?.has(rightTeam.teamId) ? ` #${seedMap.get(rightTeam.teamId)}` : ""}`
                  : "BYE"}
              </Text>
              {rightTeam && <TeamLogo logoKey={rightTeam.logoKey} teamName={rightTeam.teamName} size="small" />}
            </TouchableOpacity>
            <Text style={[colStyles.total, { color: c.accent }]}>
              {formatScore(rightWeek)}
            </Text>
            {mode !== "future" && (
              <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>
                {formatScore(rightDay)} today
              </Text>
            )}
          </View>
        </View>

        {onGoLive && (
          <TouchableOpacity
            style={[
              colStyles.goLiveBtn,
              liveActivityActive && { backgroundColor: c.secondaryText },
            ]}
            onPress={onGoLive}
            accessibilityRole="button"
            accessibilityLabel={liveActivityActive ? "Stop Live Activity" : "Start Live Activity on Dynamic Island"}
          >
            <View style={colStyles.goLiveDot} />
            <Text style={colStyles.goLiveBtnText}>
              {liveActivityActive ? "Live" : "Go Live"}
            </Text>
          </TouchableOpacity>
        )}
        </View>
      )}

      {/* Slot rows: [left player] [POS] [right player] */}
      {Array.from({ length: slotCount }).map((_, i) => {
        const lSlot = leftSlots[i] ?? null;
        const rSlot = rightSlots[i] ?? null;
        const slotPos = lSlot?.slotPosition ?? rSlot?.slotPosition ?? "";

        return (
          <View
            key={`slot-${i}`}
            style={[pStyles.slotRow, { borderBottomColor: c.border }]}
          >
            <PlayerCell
              player={lSlot?.player ?? null}
              c={c}
              side="left"
              mode={mode}
              liveStats={
                lSlot?.player
                  ? (liveMap.get(lSlot.player.player_id) ?? null)
                  : null
              }
              scoring={scoring}
              futureSchedule={futureSchedule}
              onPress={onPlayerPress}
              isCategories={isCategories}
              onFptsPress={onFptsPress}
            />
            <View style={pStyles.slotCenter}>
              <Text style={[pStyles.slotText, { color: c.secondaryText }]}>
                {slotLabel(slotPos)}
              </Text>
            </View>
            <PlayerCell
              player={rSlot?.player ?? null}
              c={c}
              side="right"
              mode={mode}
              liveStats={
                rSlot?.player
                  ? (liveMap.get(rSlot.player.player_id) ?? null)
                  : null
              }
              scoring={scoring}
              futureSchedule={futureSchedule}
              onPress={onPlayerPress}
              isCategories={isCategories}
              onFptsPress={onFptsPress}
            />
          </View>
        );
      })}

      {/* Bench section */}
      {(() => {
        const leftStarterIds = new Set(leftSlots.filter((s) => s.player).map((s) => s.player!.player_id));
        const leftBench = leftTeam.players.filter(
          (p) => !leftStarterIds.has(p.player_id) && p.roster_slot !== "IR" && p.roster_slot !== "DROPPED" && p.roster_slot !== "TAXI",
        );
        const rightStarterIds = new Set(rightSlots.filter((s) => s.player).map((s) => s.player!.player_id));
        const rightBench =
          rightTeam?.players.filter((p) => !rightStarterIds.has(p.player_id) && p.roster_slot !== "IR" && p.roster_slot !== "DROPPED" && p.roster_slot !== "TAXI") ?? [];
        if (leftBench.length === 0 && rightBench.length === 0) return null;
        const maxBench = Math.max(leftBench.length, rightBench.length);
        return (
          <View style={{ marginTop: s(16) }}>
            <View
              style={[colStyles.benchHeader, { borderBottomColor: c.border }]}
            >
              <View style={[colStyles.benchLine, { backgroundColor: c.border }]} />
              <Text
                style={[colStyles.benchLabel, { color: c.secondaryText }]}
              >
                BENCH
              </Text>
              <View style={[colStyles.benchLine, { backgroundColor: c.border }]} />
            </View>
            {Array.from({ length: maxBench }).map((_, i) => (
              <View
                key={`bench-${i}`}
                style={[
                  pStyles.slotRow,
                  { borderBottomColor: c.border, opacity: 0.7 },
                  i === maxBench - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <PlayerCell
                  player={leftBench[i] ?? null}
                  c={c}
                  side="left"
                  mode={mode}
                  liveStats={
                    leftBench[i]
                      ? (liveMap.get(leftBench[i].player_id) ?? null)
                      : null
                  }
                  scoring={scoring}
                  futureSchedule={futureSchedule}
                  onPress={onPlayerPress}
                  isCategories={isCategories}
                  onFptsPress={onFptsPress}
                />
                <View style={pStyles.slotCenter}>
                  <Text style={[pStyles.slotText, { color: c.secondaryText }]}>
                    BE
                  </Text>
                </View>
                <PlayerCell
                  player={rightBench[i] ?? null}
                  c={c}
                  side="right"
                  mode={mode}
                  liveStats={
                    rightBench[i]
                      ? (liveMap.get(rightBench[i].player_id) ?? null)
                      : null
                  }
                  scoring={scoring}
                  futureSchedule={futureSchedule}
                  onPress={onPlayerPress}
                  isCategories={isCategories}
                  onFptsPress={onFptsPress}
                />
              </View>
            ))}
          </View>
        );
      })()}

    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MatchupScreen() {
  const { leagueId, teamId } = useAppState();
  const sport = useActiveLeagueSport();
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

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
    const { data } = await supabase
      .from("player_season_stats")
      .select("*")
      .eq("player_id", playerId)
      .maybeSingle();
    if (data) setSelectedPlayer(data as PlayerSeasonStats);
  };

  const handleGoLive = async () => {
    if (!displayData || !teamId || !leagueId || !currentWeek || !isViewingOwnMatchup) return;

    // Toggle off if already active
    if (liveActivityId) {
      await endActivity(liveActivityId);
      setLiveActivityId(null);
      return;
    }

    const leftScore = weekScores?.[displayData.leftTeam.teamId] ?? displayData.leftTeam.weekTotal;
    const rightScore = displayData.rightTeam
      ? (weekScores?.[displayData.rightTeam.teamId] ?? displayData.rightTeam.weekTotal)
      : 0;

    const result = await startMatchupActivity({
      myTeamName: displayData.leftTeam.teamName,
      opponentTeamName: displayData.rightTeam?.teamName ?? "BYE",
      myTeamTricode: displayData.leftTeam.teamName.substring(0, 3).toUpperCase(),
      opponentTeamTricode: displayData.rightTeam
        ? displayData.rightTeam.teamName.substring(0, 3).toUpperCase()
        : "BYE",
      matchupId: userMatchupId!,
      leagueId,
      scheduleId: currentWeek.id,
      teamId,
      initialState: {
        myScore: leftScore,
        opponentScore: rightScore,
        scoreGap: leftScore - rightScore,
        biggestContributor: "",
        myActivePlayers: 0,
        opponentActivePlayers: 0,
        players: [],
      },
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

  // Find the user's own matchup ID
  const userMatchupId =
    allMatchups?.find(
      (m) => m.home_team_id === teamId || m.away_team_id === teamId,
    )?.id ?? null;

  // Default to user's matchup when pill data loads or week changes
  const prevWeekId = useRef(currentWeek?.id);
  useEffect(() => {
    if (currentWeek?.id !== prevWeekId.current) {
      setSelectedMatchupId(null);
      prevWeekId.current = currentWeek?.id;
    }
  }, [currentWeek?.id]);

  useEffect(() => {
    if (selectedMatchupId === null && userMatchupId) {
      setSelectedMatchupId(userMatchupId);
    }
  }, [userMatchupId, selectedMatchupId]);

  // If user has no matchup this week (eliminated), default to first available
  useEffect(() => {
    if (
      selectedMatchupId === null &&
      !userMatchupId &&
      allMatchups &&
      allMatchups.length > 0
    ) {
      setSelectedMatchupId(allMatchups[0].id);
    }
  }, [allMatchups, userMatchupId, selectedMatchupId]);

  const isViewingOwnMatchup = selectedMatchupId === userMatchupId;

  const {
    data: matchupData,
    isLoading: matchupLoading,
    isError: matchupError,
    refetch: refetchMatchup,
  } = useWeekMatchup(weeks, selectedDate, teamId, leagueId, scoring ?? []);

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

  // Collect all player IDs from both teams for live stat subscription
  const allPlayerIds: string[] = displayData
    ? [
        ...displayData.leftTeam.players.map((p) => p.player_id),
        ...(displayData.rightTeam?.players.map((p) => p.player_id) ?? []),
      ]
    : [];

  const isToday = selectedDate === today;
  const yesterday = addDays(today, -1);
  const isYesterday = selectedDate === yesterday;
  const isFutureDate = selectedDate > today;
  const weekIsLive = !!currentWeek && currentWeek.start_date <= today && today <= currentWeek.end_date;
  // Live stats for per-player display on today/yesterday only
  const rawLiveMap = useLivePlayerStats(allPlayerIds, isToday || isYesterday);

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

  // Future schedule: tricode → matchup string for the selected future date
  const { data: futureSchedule } = useQuery<Map<string, any>>({
    queryKey: [...queryKeys.futureSchedule(selectedDate), sport],
    queryFn: () => fetchNbaScheduleForDate(selectedDate, sport),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  const queryClient = useQueryClient();

  // Prefetch adjacent days to reduce pop-in when navigating
  useEffect(() => {
    if (!weeks || !teamId || !leagueId || !scoring || scoring.length === 0)
      return;
    const adjacent = [
      addDays(selectedDate, -1),
      addDays(selectedDate, 1),
      addDays(selectedDate, 2),
    ];
    const todayStr = toDateStr(new Date());

    for (const day of adjacent) {
      const wk = weeks.find((w) => w.start_date <= day && day <= w.end_date);
      if (!wk) continue;

      queryClient.prefetchQuery({
        queryKey: queryKeys.weekMatchup(leagueId!, wk.id, teamId, day),
        queryFn: () => fetchWeekMatchupData(wk, teamId, leagueId, day, scoring),
        staleTime: 1000 * 60 * 2,
      });

      if (day >= todayStr) {
        queryClient.prefetchQuery({
          queryKey: [...queryKeys.futureSchedule(day), sport],
          queryFn: () => fetchNbaScheduleForDate(day, sport),
          staleTime: 1000 * 60 * 60,
        });
      }
    }
  }, [selectedDate, weeks, teamId, leagueId, scoring, sport]);

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
      return fetchTeamSeeds(leagueId!, CURRENT_NBA_SEASON, round);
    },
    enabled: !!leagueId && !!currentWeek?.is_playoff,
    staleTime: 1000 * 60 * 5,
  });

  // Weekly acquisition limit display for both teams
  const weeklyLimit = (league?.weekly_acquisition_limit as number | null) ?? null;
  const leftTeamId = displayData?.leftTeam.teamId ?? null;
  const rightTeamId = displayData?.rightTeam?.teamId ?? null;

  const { data: leftAdds } = useQuery({
    queryKey: queryKeys.weeklyAdds(leagueId!, leftTeamId!),
    queryFn: () => fetchWeeklyAdds(leagueId!, leftTeamId!),
    enabled: !!leagueId && !!leftTeamId && weeklyLimit != null,
    staleTime: 1000 * 60 * 2,
  });

  const { data: rightAdds } = useQuery({
    queryKey: queryKeys.weeklyAdds(leagueId!, rightTeamId!),
    queryFn: () => fetchWeeklyAdds(leagueId!, rightTeamId!),
    enabled: !!leagueId && !!rightTeamId && weeklyLimit != null,
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
          p.roster_slot === "DROPPED"
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

  if (weeksLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: c.background }]}
      >
        {/* Placeholder day nav */}
        <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
          <View style={styles.navArrow}>
            <Text style={[styles.arrow, { color: c.buttonDisabled }]}>‹</Text>
          </View>
          <View style={styles.dayInfo}>
            <SkeletonBlock width={120} height={16} color={c.border} />
            <SkeletonBlock
              width={160}
              height={11}
              color={c.border}
              style={{ marginTop: 4 }}
            />
          </View>
          <View style={styles.navArrow}>
            <Text style={[styles.arrow, { color: c.buttonDisabled }]}>›</Text>
          </View>
        </View>
        <View style={styles.spinnerWrap}>
          <LogoSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!weeks || weeks.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="defaultSemiBold">Season not started yet.</ThemedText>
        <ThemedText
          style={{ color: c.secondaryText, marginTop: 6, textAlign: "center" }}
        >
          The commissioner needs to generate the schedule after the draft.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Day navigation */}
      <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          disabled={selectedDate <= minDate}
          onPress={() => setSelectedDate(addDays(selectedDate, -1))}
          style={styles.navArrow}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          accessibilityState={{ disabled: selectedDate <= minDate }}
        >
          <Text
            style={[
              styles.arrow,
              { color: selectedDate <= minDate ? c.buttonDisabled : c.text },
            ]}
          >
            ‹
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dayInfo}
          onPress={() => setScheduleVisible(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${formatDayLabel(selectedDate)}${currentWeek ? `, Week ${currentWeek.week_number}` : ", outside season"}`}
          accessibilityHint="Opens week schedule picker"
        >
          <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
            {formatDayLabel(selectedDate)} ▾
          </ThemedText>
          {currentWeek && (
            <ThemedText style={[styles.weekMeta, { color: c.secondaryText }]}>
              {currentWeek.is_playoff ? "Playoffs · " : ""}Week{" "}
              {currentWeek.week_number} ·{" "}
              {formatWeekRange(currentWeek.start_date, currentWeek.end_date)}
            </ThemedText>
          )}
          {!currentWeek && (
            <ThemedText style={[styles.weekMeta, { color: c.secondaryText }]}>
              Outside season
            </ThemedText>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          disabled={selectedDate >= maxDate}
          onPress={() => setSelectedDate(addDays(selectedDate, 1))}
          style={styles.navArrow}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: selectedDate >= maxDate }}
        >
          <Text
            style={[
              styles.arrow,
              { color: selectedDate >= maxDate ? c.buttonDisabled : c.text },
            ]}
          >
            ›
          </Text>
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

      {/* Matchup pill bar */}
      {allMatchups && allMatchups.length > 1 && teamNames && (
        <MatchupPillBar
          allMatchups={allMatchups}
          teamNames={teamNames}
          teamId={teamId}
          selectedMatchupId={selectedMatchupId}
          colors={{
            border: c.border,
            accent: c.accent,
            activeCard: c.activeCard,
            activeBorder: c.activeBorder,
            card: c.card,
            text: c.text,
            secondaryText: c.secondaryText,
          }}
          onSelect={(id) => {
            setPillTransitioning(true);
            setSelectedMatchupId(id);
          }}
        />
      )}

      {/* Matchup body */}
      {displayLoading && (
        <View style={styles.spinnerWrap}>
          <LogoSpinner />
        </View>
      )}

      {!displayLoading && (
      <ScrollView contentContainerStyle={styles.body}>
        {matchupError && isViewingOwnMatchup && (
          <ErrorState
            message="Failed to load matchup"
            onRetry={() => refetchMatchup()}
          />
        )}

        {!currentWeek && (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>
              No matchup for this date.
            </ThemedText>
          </View>
        )}

        {currentWeek && !displayData && (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>
              {currentWeek.is_playoff
                ? "No matchup this playoff week."
                : "No matchup found for this week."}
            </ThemedText>
          </View>
        )}

        {displayData && (
          <>
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
              leftWeekScore={weekScores?.[displayData.leftTeam.teamId] ?? displayData.leftTeam.weekTotal}
              rightWeekScore={
                displayData.rightTeam
                  ? (weekScores?.[displayData.rightTeam.teamId] ?? displayData.rightTeam.weekTotal)
                  : 0
              }
              leftDayLiveBonus={computeLiveBonusFrom(displayData.leftTeam.players, liveMap)}
              rightDayLiveBonus={
                displayData.rightTeam
                  ? computeLiveBonusFrom(displayData.rightTeam.players, liveMap)
                  : 0
              }
              futureSchedule={futureSchedule}
              seedMap={seedMap ?? undefined}
              onPlayerPress={handlePlayerPress}
              onFptsPress={(stats, name, label) =>
                setFptsBreakdown({ stats, playerName: name, gameLabel: label })
              }
              onSummaryPress={() => setWeeklySummaryVisible(true)}
              onGoLive={
                liveActivitySupported && isViewingOwnMatchup && weekIsLive
                  ? handleGoLive
                  : undefined
              }
              liveActivityActive={!!liveActivityId}
              scoringType={league?.scoring_type}
              onTeamPress={(id) => {
                if (id === teamId) router.push('/(tabs)/roster');
                else router.push(`/team-roster/${id}` as any);
              }}
            />

            {/* Weekly acquisition limits */}
            {weeklyLimit != null && (
              <View
                style={[
                  colStyles.acqRow,
                  { borderTopColor: c.border },
                ]}
                accessibilityLabel={`Weekly acquisitions: ${displayData.leftTeam.teamName} ${leftAdds ?? 0} of ${weeklyLimit}, ${displayData.rightTeam?.teamName ?? "BYE"} ${rightAdds ?? 0} of ${weeklyLimit}`}
              >
                <TouchableOpacity
                  style={colStyles.acqPill}
                  onPress={() => setAcqInfoVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Acquisition info"
                >
                  <Text
                    style={[
                      colStyles.acqText,
                      {
                        color:
                          (leftAdds ?? 0) >= weeklyLimit
                            ? c.danger
                            : c.secondaryText,
                      },
                    ]}
                  >
                    Acq: {leftAdds ?? 0}/{weeklyLimit}
                  </Text>
                </TouchableOpacity>
                {displayData.rightTeam && (
                  <View style={colStyles.acqPill}>
                    <Text
                      style={[
                        colStyles.acqText,
                        {
                          color:
                            (rightAdds ?? 0) >= weeklyLimit
                              ? c.danger
                              : c.secondaryText,
                        },
                      ]}
                    >
                      Acq: {rightAdds ?? 0}/{weeklyLimit}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
      )}

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

      {scoring && displayData && currentWeek && (
        <WeeklySummaryModal
          visible={weeklySummaryVisible}
          onClose={() => setWeeklySummaryVisible(false)}
          homeTeam={{ teamName: displayData.leftTeam.teamName, players: displayData.leftTeam.players }}
          awayTeam={
            displayData.rightTeam
              ? { teamName: displayData.rightTeam.teamName, players: displayData.rightTeam.players }
              : null
          }
          scoring={scoring}
          weekLabel={`Week ${currentWeek.week_number} · ${formatWeekRange(currentWeek.start_date, currentWeek.end_date)}`}
          liveMap={rawLiveMap}
        />
      )}

      <WeekScheduleModal
        visible={scheduleVisible}
        weeks={weeks}
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

