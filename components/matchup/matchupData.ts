import { useQuery } from "@tanstack/react-query";

import { type PillMatchup } from "@/components/matchup/MatchupPillBar";
import { RosterPlayer, round1 } from "@/components/matchup/PlayerCell";
import { queryKeys } from "@/constants/queryKeys";
import { RosterConfigSlot } from "@/hooks/useLeagueRosterConfig";
import { supabase } from "@/lib/supabase";
import { ScoringWeight } from "@/types/player";
import { parseLocalDate } from "@/utils/dates";
import { liveToGameLog, type LivePlayerStats } from "@/utils/nba/nbaLive";
import { fetchTeamData, sumStarterDayPoints } from "@/utils/roster/fetchTeamData";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import {
  computeCategoryResults,
  type CategoryMatchupResult,
  type TeamStatTotals,
} from "@/utils/scoring/categoryScoring";

// Data layer for the Matchup tab: types, pure slot/label helpers, Supabase
// fetchers, and the React Query hooks. Split out of (tabs)/matchup.tsx so the
// route file holds only the MatchupBoard + MatchupScreen view components.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
  /** Two break-straddling weeks merged into one matchup (All-Star, FIBA, Cup). */
  is_double_week: boolean;
}

export interface Matchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  playoff_round: number | null;
  is_finalized: boolean;
}

export interface TeamMatchupData {
  teamId: string;
  teamName: string;
  logoKey: string | null;
  tricode: string | null;
  wins: number;
  losses: number;
  ties: number;
  players: RosterPlayer[];
  /** Players dropped mid-week — off the board, but the weekly summary
   *  still credits the points they scored before being dropped. */
  droppedPlayers: RosterPlayer[];
  weekTotal: number;
  dayTotal: number;
  teamStats: TeamStatTotals;
}

export interface MatchupSlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

// Build a fixed-length array of slot entries from the roster config, mapping players into their slots.
// Empty slots show as null. This ensures both teams always display the same number of rows.
export function buildMatchupSlots(
  players: RosterPlayer[],
  config: RosterConfigSlot[],
): MatchupSlotEntry[] {
  const activeConfigs = config.filter(
    (c) =>
      c.position !== "BE" &&
      c.position !== "IR" &&
      c.position !== ROSTER_SLOT.TAXI,
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

// ─── Category scoring (live merge) ─────────────────────────────────────────────

// Merge live in-progress game stats into a team's DB-based teamStats. Skips
// non-scoring slots (bench/IR/dropped) so only active starters count, mirroring
// the matchup score. Returns the stored totals untouched when no live data is
// present. Shared by the category scoreboard (board) and the hero category
// tally (screen) so the two always agree.
export function mergeTeamStatsWithLive(
  team: TeamMatchupData,
  liveMap: Map<string, LivePlayerStats>,
): TeamStatTotals {
  if (liveMap.size === 0) return team.teamStats;
  const merged = { ...team.teamStats };
  for (const p of team.players) {
    if (
      p.roster_slot === "BE" ||
      p.roster_slot === "IR" ||
      p.roster_slot === ROSTER_SLOT.DROPPED
    )
      continue;
    const live = liveMap.get(p.player_id);
    if (!live) continue;
    const gameLog = liveToGameLog(live);
    for (const [key, val] of Object.entries(gameLog)) {
      if (val == null) continue;
      const numVal = typeof val === "boolean" ? (val ? 1 : 0) : Number(val);
      merged[key] = (merged[key] ?? 0) + numVal;
    }
  }
  return merged;
}

// Compute the live H2H category comparison between two teams, merging any
// in-progress game stats first. Returns null when the right team is absent
// (bye week). The `scoring` rows carry which categories are enabled + which
// are inverse (lower-is-better, e.g. turnovers).
export function computeLiveCategoryResults(
  leftTeam: TeamMatchupData,
  rightTeam: TeamMatchupData | null,
  scoring: ScoringWeight[],
  liveMap: Map<string, LivePlayerStats>,
): CategoryMatchupResult | null {
  if (!rightTeam) return null;
  return computeCategoryResults(
    mergeTeamStatsWithLive(leftTeam, liveMap),
    mergeTeamStatsWithLive(rightTeam, liveMap),
    scoring.map((s) => ({ stat_name: s.stat_name, inverse: s.inverse ?? false })),
  );
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchWeeks(leagueId: string): Promise<Week[]> {
  const { data, error } = await supabase
    .from("league_schedule")
    .select("id, week_number, start_date, end_date, is_playoff, is_double_week")
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
      "id, home_team_id, away_team_id, home_score, away_score, playoff_round, is_finalized",
    )
    .eq("schedule_id", scheduleId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (error) throw error;
  return data as Matchup | null;
}

interface TeamInfo {
  name: string;
  logoKey: string | null;
  tricode: string | null;
  wins: number;
  losses: number;
  ties: number;
}

async function fetchTeamInfo(teamId: string): Promise<TeamInfo> {
  const { data } = await supabase
    .from("teams")
    .select("name, logo_key, tricode, wins, losses, ties")
    .eq("id", teamId)
    .single();
  return {
    name: data?.name ?? "Unknown Team",
    logoKey: data?.logo_key ?? null,
    tricode: data?.tricode ?? null,
    wins: data?.wins ?? 0,
    losses: data?.losses ?? 0,
    ties: data?.ties ?? 0,
  };
}

export async function fetchAllWeekMatchups(
  scheduleId: string,
): Promise<PillMatchup[]> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select("id, home_team_id, away_team_id")
    .eq("schedule_id", scheduleId);
  if (error) throw error;
  return data ?? [];
}

// Counts waiver acquisitions for a team within the given schedule week.
// Date-bound so users browsing a future week see 0 (no claims yet) and
// users browsing a past week see that week's historical count, instead
// of always seeing the calendar week's running total.
export async function fetchWeeklyAdds(
  leagueId: string,
  teamId: string,
  weekStart: string,
  weekEnd: string,
): Promise<number> {
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
    .gte("created_at", weekStart + "T00:00:00")
    .lte("created_at", weekEnd + "T23:59:59");
  if (error) throw error;
  return count ?? 0;
}

// Fetch seeds for a specific team in the current playoff round
export async function fetchTeamSeeds(
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

export async function fetchWeekMatchupData(
  week: Week,
  teamId: string,
  leagueId: string,
  selectedDate: string,
  scoring: ScoringWeight[],
  sport: string | null | undefined,
): Promise<{
  myTeam: TeamMatchupData;
  opponentTeam: TeamMatchupData | null;
  week: Week;
} | null> {
  const matchup = await fetchMatchupForWeek(week.id, teamId);
  if (!matchup) return null;

  const isHome = matchup.home_team_id === teamId;
  const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;

  // Always resolve slots and stats live from daily_lineups + player_games so the
  // matchup page mirrors the roster page exactly. Wins/losses are still locked
  // by league_matchups.home_score/away_score on finalized weeks.
  const [myResult, myInfo, oppResult, oppInfo] = await Promise.all([
    fetchTeamData(teamId, leagueId, week, selectedDate, scoring, sport),
    fetchTeamInfo(teamId),
    opponentId
      ? fetchTeamData(opponentId, leagueId, week, selectedDate, scoring, sport)
      : Promise.resolve(null),
    opponentId ? fetchTeamInfo(opponentId) : Promise.resolve(null),
  ]);

  let opponentTeam: TeamMatchupData | null = null;
  if (opponentId && oppResult && oppInfo) {
    opponentTeam = {
      teamId: opponentId,
      teamName: oppInfo.name,
      logoKey: oppInfo.logoKey,
      tricode: oppInfo.tricode,
      wins: oppInfo.wins,
      losses: oppInfo.losses,
      ties: oppInfo.ties,
      players: oppResult.players,
      droppedPlayers: oppResult.droppedPlayers,
      weekTotal: oppResult.weekTotalAll ?? round1(
        oppResult.players.reduce((s, p) => s + p.weekPoints, 0),
      ),
      dayTotal: round1(sumStarterDayPoints(oppResult.players)),
      teamStats: oppResult.teamStats,
    };
  }

  return {
    myTeam: {
      teamId,
      teamName: myInfo.name,
      logoKey: myInfo.logoKey,
      tricode: myInfo.tricode,
      wins: myInfo.wins,
      losses: myInfo.losses,
      ties: myInfo.ties,
      players: myResult.players,
      droppedPlayers: myResult.droppedPlayers,
      weekTotal: myResult.weekTotalAll ?? round1(myResult.players.reduce((s, p) => s + p.weekPoints, 0)),
      dayTotal: round1(sumStarterDayPoints(myResult.players)),
      teamStats: myResult.teamStats,
    },
    opponentTeam,
    week,
  };
}

export async function fetchMatchupDataById(
  matchupId: string,
  week: Week,
  leagueId: string,
  selectedDate: string,
  scoring: ScoringWeight[],
  sport: string | null | undefined,
): Promise<{ homeTeam: TeamMatchupData; awayTeam: TeamMatchupData | null }> {
  const { data: matchup, error } = await supabase
    .from("league_matchups")
    .select("id, home_team_id, away_team_id, is_finalized")
    .eq("id", matchupId)
    .single();
  if (error) throw error;

  const [homeInfo, awayInfo] = await Promise.all([
    fetchTeamInfo(matchup.home_team_id),
    matchup.away_team_id
      ? fetchTeamInfo(matchup.away_team_id)
      : Promise.resolve(null),
  ]);

  // Always resolve slots and stats live — see fetchWeekMatchupData for rationale.
  const [homeResult, awayResult] = await Promise.all([
    fetchTeamData(matchup.home_team_id, leagueId, week, selectedDate, scoring, sport),
    matchup.away_team_id
      ? fetchTeamData(
          matchup.away_team_id,
          leagueId,
          week,
          selectedDate,
          scoring,
          sport,
        )
      : Promise.resolve(null),
  ]);

  const homeTeam: TeamMatchupData = {
    teamId: matchup.home_team_id,
    teamName: homeInfo.name,
    logoKey: homeInfo.logoKey,
    tricode: homeInfo.tricode,
    wins: homeInfo.wins,
    losses: homeInfo.losses,
    ties: homeInfo.ties,
    players: homeResult.players,
    droppedPlayers: homeResult.droppedPlayers,
    weekTotal: homeResult.weekTotalAll ?? round1(homeResult.players.reduce((s, p) => s + p.weekPoints, 0)),
    dayTotal: round1(sumStarterDayPoints(homeResult.players)),
    teamStats: homeResult.teamStats,
  };

  let awayTeam: TeamMatchupData | null = null;
  if (matchup.away_team_id && awayInfo && awayResult) {
    awayTeam = {
      teamId: matchup.away_team_id,
      teamName: awayInfo.name,
      logoKey: awayInfo.logoKey,
      tricode: awayInfo.tricode,
      wins: awayInfo.wins,
      losses: awayInfo.losses,
      ties: awayInfo.ties,
      players: awayResult.players,
      droppedPlayers: awayResult.droppedPlayers,
      weekTotal: awayResult.weekTotalAll ?? round1(
        awayResult.players.reduce((s, p) => s + p.weekPoints, 0),
      ),
      dayTotal: round1(sumStarterDayPoints(awayResult.players)),
      teamStats: awayResult.teamStats,
    };
  }

  return { homeTeam, awayTeam };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: queryKeys.leagueSchedule(leagueId!),
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

export function useWeekMatchup(
  weeks: Week[] | undefined,
  selectedDate: string,
  teamId: string | null,
  leagueId: string | null,
  scoring: ScoringWeight[],
  sport: string | null | undefined,
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
        sport,
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
