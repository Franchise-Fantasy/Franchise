import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type PillMatchup } from "@/components/matchup/MatchupPillBar";
import { RosterPlayer, round1, buildStatLine } from "@/components/matchup/PlayerCell";
import { queryKeys } from "@/constants/queryKeys";
import { RosterConfigSlot } from "@/hooks/useLeagueRosterConfig";
import { supabase } from "@/lib/supabase";
import { ScoringWeight } from "@/types/player";
import { parseLocalDate } from "@/utils/dates";
import { getSportToday } from "@/utils/leagueTime";
import { liveToGameLog, type LivePlayerStats } from "@/utils/nba/nbaLive";
import {
  deriveTeamDayData,
  fetchTeamData,
  fetchTeamWeekData,
  sumStarterDayPoints,
  type TeamWeekRaw,
} from "@/utils/roster/fetchTeamData";
import { isActiveSlot } from "@/utils/roster/resolveSlot";
import { baseSlotName, ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import {
  aggregateTeamStats,
  computeCategoryResults,
  type CategoryMatchupResult,
  type CategoryResult,
  type TeamStatTotals,
} from "@/utils/scoring/categoryScoring";
import { isWeeklyLineupSport } from "@/utils/sports/registry";

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
  home_category_wins: number | null;
  away_category_wins: number | null;
  category_ties: number | null;
  // Frozen-at-finalize snapshots. Present once finalized; read instead of
  // recomputing from the (mutable) daily_lineups so the detail page can't
  // disagree with the scoreboard/standings.
  home_player_scores: FrozenPlayerScore[] | null;
  away_player_scores: FrozenPlayerScore[] | null;
  category_results: CategoryResult[] | null;
}

/** One player's frozen per-game breakdown, as finalize-week persists it. */
export interface FrozenPlayerScore {
  player_id: string;
  name: string;
  position: string | null;
  pro_team: string | null;
  external_id_nba: string | null;
  roster_slot: string;
  week_points: number;
  games: {
    date: string;
    slot: string;
    fpts: number;
    stats: Record<string, number | boolean>;
    matchup: string | null;
  }[];
}

/** Category win/loss/tie record from the left team's perspective. */
export interface CategoryRecord {
  leftWins: number;
  rightWins: number;
  ties: number;
}

/** Frozen score for a finalized matchup, oriented to the display's left/right. */
export interface FinalizedScore {
  left: number;
  right: number;
}

// The stored, finalize-week-authored category record for a matchup, mapped to
// the display's left/right orientation. Only present once the matchup is
// finalized — until then the board/hero recompute it live from box scores.
// Returning it lets the matchup page show the FROZEN result for past weeks
// instead of re-deriving it (which drifts when live games are in progress or
// the underlying data changes), keeping the page in sync with standings.
function buildFinalizedCategoryRecord(
  matchup: Pick<
    Matchup,
    "is_finalized" | "home_category_wins" | "away_category_wins" | "category_ties"
  >,
  leftIsHome: boolean,
): CategoryRecord | null {
  if (!matchup.is_finalized || matchup.home_category_wins == null) return null;
  const home = matchup.home_category_wins;
  const away = matchup.away_category_wins ?? 0;
  const ties = matchup.category_ties ?? 0;
  return leftIsHome
    ? { leftWins: home, rightWins: away, ties }
    : { leftWins: away, rightWins: home, ties };
}

// Re-orient finalize-week's stored per-category breakdown (home/away) to the
// display's left/right and tally W/L/T. Returns the same shape the live
// recompute produces so CategoryScoreboard renders identically. `home` in the
// result means the LEFT team.
function orientFrozenCategoryResults(
  stored: CategoryResult[],
  leftIsHome: boolean,
): CategoryMatchupResult {
  const results: CategoryResult[] = stored.map((r) =>
    leftIsHome
      ? r
      : {
          stat: r.stat,
          home: r.away,
          away: r.home,
          winner:
            r.winner === "home" ? "away" : r.winner === "away" ? "home" : "tie",
        },
  );
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  for (const r of results) {
    if (r.winner === "home") homeWins++;
    else if (r.winner === "away") awayWins++;
    else ties++;
  }
  return { results, homeWins, awayWins, ties };
}

// Build a team's matchup display data from finalize-week's frozen per-player
// snapshot instead of re-deriving it from the (mutable) daily_lineups. Used
// for FINALIZED matchups so the detail page mirrors the locked
// league_matchups result that the scoreboard/standings read — a post-finalize
// lineup edit can no longer drift the displayed score. `selectedDate` drives
// the per-day cells (a player's slot/points for the viewed day come from that
// day's frozen game).
function buildTeamDataFromFrozen(
  teamId: string,
  info: TeamInfo,
  playerScores: FrozenPlayerScore[],
  selectedDate: string,
  scoring: ScoringWeight[],
  sport?: string | null,
): TeamMatchupData {
  const activeGamesAll: Record<string, number | boolean>[] = [];

  const rosterPlayers: RosterPlayer[] = playerScores.map((ps) => {
    const games = ps.games ?? [];
    // Weekly sports (NFL) show the week's single game regardless of the pinned
    // anchor day — prefer the started game, else the player's only game.
    const dayGame = isWeeklyLineupSport(sport)
      ? (games.find((g) => isActiveSlot(g.slot)) ?? games[0] ?? null)
      : (games.find((g) => g.date === selectedDate) ?? null);
    // The viewed day's slot wins; otherwise fall back to the standing slot.
    const displaySlot = dayGame?.slot ?? ps.roster_slot ?? "BE";

    // Aggregate this player's active (started) games for the week summary, and
    // collect them into the team-wide active pool for category teamStats.
    const weekStats: Record<string, number> = {};
    let weekGames = 0;
    for (const g of games) {
      if (!isActiveSlot(g.slot)) continue;
      activeGamesAll.push(g.stats);
      weekGames++;
      for (const [key, val] of Object.entries(g.stats)) {
        if (val == null) continue;
        const num = typeof val === "boolean" ? (val ? 1 : 0) : Number(val);
        weekStats[key] = (weekStats[key] ?? 0) + num;
      }
    }

    const t = ps.pro_team ?? "";
    const nbaTricode = t && t !== "Active" && t !== "Inactive" ? t : null;

    return {
      player_id: ps.player_id,
      name: ps.name ?? "—",
      position: ps.position ?? "—",
      pro_team: t,
      external_id_nba: ps.external_id_nba ? Number(ps.external_id_nba) : null,
      status: "active",
      nbaTricode,
      roster_slot: displaySlot,
      weekPoints: round1(ps.week_points ?? 0),
      weekGames,
      seasonAvgFpts: null,
      dayPoints: round1(dayGame?.fpts ?? 0),
      dayMatchup: dayGame?.matchup ?? null,
      dayStatLine: dayGame ? buildStatLine(dayGame.stats as Record<string, number>, scoring, sport) : null,
      dayGameStats: dayGame?.stats ?? null,
      projectedFpts: null,
      weekGameStats: weekStats,
    };
  });

  const droppedPlayers = rosterPlayers.filter(
    (p) => p.roster_slot === ROSTER_SLOT.DROPPED,
  );
  const visiblePlayers = rosterPlayers.filter(
    (p) => p.roster_slot !== ROSTER_SLOT.DROPPED,
  );

  return {
    teamId,
    teamName: info.name,
    logoKey: info.logoKey,
    tricode: info.tricode,
    wins: info.wins,
    losses: info.losses,
    ties: info.ties,
    players: visiblePlayers,
    droppedPlayers,
    weekTotal: round1(rosterPlayers.reduce((s, p) => s + p.weekPoints, 0)),
    dayTotal: round1(sumStarterDayPoints(visiblePlayers)),
    teamStats: aggregateTeamStats(activeGamesAll),
  };
}

// Map a live fetchTeamData result + team info into TeamMatchupData. Used for
// in-progress (not-yet-finalized) weeks, where scores must reflect the current
// roster/lineup.
function buildLiveTeam(
  teamId: string,
  info: TeamInfo,
  result: Awaited<ReturnType<typeof fetchTeamData>>,
): TeamMatchupData {
  return {
    teamId,
    teamName: info.name,
    logoKey: info.logoKey,
    tricode: info.tricode,
    wins: info.wins,
    losses: info.losses,
    ties: info.ties,
    players: result.players,
    droppedPlayers: result.droppedPlayers,
    weekTotal:
      result.weekTotalAll ??
      round1(result.players.reduce((s, p) => s + p.weekPoints, 0)),
    dayTotal: round1(sumStarterDayPoints(result.players)),
    teamStats: result.teamStats,
  };
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
  // Track placed players so the rest fall to bench
  const placedPlayerIds = new Set<string>();

  // Each active position fills its seats left-to-right from the players whose
  // slot resolves to that base position (baseSlotName collapses UTIL1/UTIL2 →
  // UTIL). Matching by base position + positional fill — rather than an exact
  // seat string like `=== "UTIL2"` — can never double-book a seat, so a stray
  // duplicate slot string can't bump a real starter onto the bench. Mirrors the
  // roster page's placement so the two always agree.
  for (const cfg of activeConfigs) {
    const isUtil = cfg.position === "UTIL";
    const inPosition = players
      .filter((p) => baseSlotName(p.roster_slot ?? "") === cfg.position && !placedPlayerIds.has(p.player_id))
      // Prefer players who actually played that day. In a finalized recap a
      // non-playing player can carry a stale week-level slot (there's no
      // per-day frozen entry for a day they didn't play), and that must not
      // occupy a seat ahead of someone who really played it. Stable sort keeps
      // array order within each group, so the live path (where everyone has the
      // day's accurate slot) is unaffected.
      .sort((a, b) => (b.dayGameStats ? 1 : 0) - (a.dayGameStats ? 1 : 0));
    for (let i = 0; i < cfg.slot_count; i++) {
      const player = inPosition[i] ?? null;
      if (player) placedPlayerIds.add(player.player_id);
      slots.push({ slotPosition: isUtil ? `UTIL${i + 1}` : cfg.position, slotIndex: i, player });
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
    // Only enabled categories count — mirrors finalize-week, which skips
    // disabled ones. Without this filter a disabled category drifts the live
    // tally away from the frozen record.
    scoring
      .filter((s) => (s as { is_enabled?: boolean }).is_enabled !== false)
      .map((s) => ({ stat_name: s.stat_name, inverse: s.inverse ?? false })),
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
      "id, home_team_id, away_team_id, home_score, away_score, playoff_round, is_finalized, home_category_wins, away_category_wins, category_ties, home_player_scores, away_player_scores, category_results",
    )
    .eq("schedule_id", scheduleId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Matchup | null;
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

/** Date-independent fetched state for the user's matchup in one week.
 *  Derive any day's view with deriveWeekMatchupData — day swipes inside the
 *  week never refetch. */
export interface WeekMatchupRaw {
  matchup: Matchup;
  teamId: string;
  isHome: boolean;
  myInfo: TeamInfo;
  oppInfo: TeamInfo | null;
  /** Raw week data for the live path; null when the side renders frozen. */
  myRaw: TeamWeekRaw | null;
  oppRaw: TeamWeekRaw | null;
  week: Week;
}

export interface WeekMatchupView {
  myTeam: TeamMatchupData;
  opponentTeam: TeamMatchupData | null;
  week: Week;
  isFinalized: boolean;
  categoryRecord: CategoryRecord | null;
  finalizedScore: FinalizedScore | null;
  categoryResults: CategoryMatchupResult | null;
}

export async function fetchWeekMatchupRaw(
  week: Week,
  teamId: string,
  leagueId: string,
  liveMode: boolean,
  sport: string | null | undefined,
): Promise<WeekMatchupRaw | null> {
  const matchup = await fetchMatchupForWeek(week.id, teamId);
  if (!matchup) return null;

  const isHome = matchup.home_team_id === teamId;
  const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;

  // FINALIZED weeks render from the frozen per-player snapshot (the same source
  // standings + scoreboard read) so a post-finalize lineup edit can't drift the
  // displayed score. In-progress weeks resolve live from daily_lineups +
  // player_games so the page mirrors the roster page and ticks up with games.
  const myFrozen = isHome ? matchup.home_player_scores : matchup.away_player_scores;
  const oppFrozen = isHome ? matchup.away_player_scores : matchup.home_player_scores;
  const useFrozenMy = matchup.is_finalized && !!myFrozen;
  const useFrozenOpp = matchup.is_finalized && !!oppFrozen;

  const [myInfo, oppInfo, myRaw, oppRaw] = await Promise.all([
    fetchTeamInfo(teamId),
    opponentId ? fetchTeamInfo(opponentId) : Promise.resolve(null),
    useFrozenMy
      ? Promise.resolve(null)
      : fetchTeamWeekData(teamId, leagueId, week, liveMode, sport),
    !opponentId || useFrozenOpp
      ? Promise.resolve(null)
      : fetchTeamWeekData(opponentId, leagueId, week, liveMode, sport),
  ]);

  return { matchup, teamId, isHome, myInfo, oppInfo, myRaw, oppRaw, week };
}

/** Pure per-day view of a fetched week — the same shape the old date-keyed
 *  fetch returned, so consumers are unchanged. */
export function deriveWeekMatchupData(
  raw: WeekMatchupRaw | null,
  selectedDate: string,
  scoring: ScoringWeight[],
  sport: string | null | undefined,
): WeekMatchupView | null {
  if (!raw) return null;
  const { matchup, teamId, isHome, myInfo, oppInfo, myRaw, oppRaw, week } = raw;
  const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;

  const myFrozen = isHome ? matchup.home_player_scores : matchup.away_player_scores;
  const oppFrozen = isHome ? matchup.away_player_scores : matchup.home_player_scores;
  const useFrozenMy = matchup.is_finalized && !!myFrozen;
  const useFrozenOpp = matchup.is_finalized && !!oppFrozen;

  const myTeam = useFrozenMy
    ? buildTeamDataFromFrozen(teamId, myInfo, myFrozen!, selectedDate, scoring, sport)
    : buildLiveTeam(
        teamId,
        myInfo,
        deriveTeamDayData(myRaw!, week, selectedDate, scoring, sport),
      );

  let opponentTeam: TeamMatchupData | null = null;
  if (opponentId && oppInfo) {
    opponentTeam = useFrozenOpp
      ? buildTeamDataFromFrozen(opponentId, oppInfo, oppFrozen!, selectedDate, scoring, sport)
      : oppRaw
        ? buildLiveTeam(
            opponentId,
            oppInfo,
            deriveTeamDayData(oppRaw, week, selectedDate, scoring, sport),
          )
        : null;
  }

  return {
    myTeam,
    opponentTeam,
    week,
    isFinalized: matchup.is_finalized,
    // Left team is myTeam, which is home iff the user is the home side.
    categoryRecord: buildFinalizedCategoryRecord(matchup, isHome),
    finalizedScore: matchup.is_finalized
      ? {
          left: isHome ? matchup.home_score : matchup.away_score,
          right: isHome ? matchup.away_score : matchup.home_score,
        }
      : null,
    categoryResults:
      matchup.is_finalized && matchup.category_results
        ? orientFrozenCategoryResults(matchup.category_results, isHome)
        : null,
  };
}

export async function fetchMatchupDataById(
  matchupId: string,
  week: Week,
  leagueId: string,
  selectedDate: string,
  scoring: ScoringWeight[],
  sport: string | null | undefined,
): Promise<{
  homeTeam: TeamMatchupData;
  awayTeam: TeamMatchupData | null;
  isFinalized: boolean;
  categoryRecord: CategoryRecord | null;
  finalizedScore: FinalizedScore | null;
  categoryResults: CategoryMatchupResult | null;
}> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select(
      "id, home_team_id, away_team_id, home_score, away_score, is_finalized, home_category_wins, away_category_wins, category_ties, home_player_scores, away_player_scores, category_results",
    )
    .eq("id", matchupId)
    .single();
  if (error) throw error;
  const matchup = data as unknown as Matchup;

  // Left team is always the home team here — see fetchWeekMatchupRaw for the
  // frozen-vs-live rationale.
  const useFrozenHome = matchup.is_finalized && !!matchup.home_player_scores;
  const useFrozenAway = matchup.is_finalized && !!matchup.away_player_scores;

  const [homeInfo, awayInfo, homeResult, awayResult] = await Promise.all([
    fetchTeamInfo(matchup.home_team_id),
    matchup.away_team_id
      ? fetchTeamInfo(matchup.away_team_id)
      : Promise.resolve(null),
    useFrozenHome
      ? Promise.resolve(null)
      : fetchTeamData(matchup.home_team_id, leagueId, week, selectedDate, scoring, sport),
    !matchup.away_team_id || useFrozenAway
      ? Promise.resolve(null)
      : fetchTeamData(matchup.away_team_id, leagueId, week, selectedDate, scoring, sport),
  ]);

  const homeTeam = useFrozenHome
    ? buildTeamDataFromFrozen(
        matchup.home_team_id,
        homeInfo,
        matchup.home_player_scores!,
        selectedDate,
        scoring,
        sport,
      )
    : buildLiveTeam(matchup.home_team_id, homeInfo, homeResult!);

  let awayTeam: TeamMatchupData | null = null;
  if (matchup.away_team_id && awayInfo) {
    awayTeam = useFrozenAway
      ? buildTeamDataFromFrozen(
          matchup.away_team_id,
          awayInfo,
          matchup.away_player_scores!,
          selectedDate,
          scoring,
          sport,
        )
      : awayResult
        ? buildLiveTeam(matchup.away_team_id, awayInfo, awayResult)
        : null;
  }

  return {
    homeTeam,
    awayTeam,
    isFinalized: matchup.is_finalized,
    categoryRecord: buildFinalizedCategoryRecord(matchup, true),
    finalizedScore: matchup.is_finalized
      ? { left: matchup.home_score, right: matchup.away_score }
      : null,
    categoryResults:
      matchup.is_finalized && matchup.category_results
        ? orientFrozenCategoryResults(matchup.category_results, true)
        : null,
  };
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

  // The fetch is WEEK-keyed, not date-keyed: swiping days inside a week
  // derives in memory from one cached raw fetch instead of re-running ~10
  // queries per swipe. The only date-shaped fetch input is the live/past
  // branch (live views stop game logs at yesterday), so that flag joins the
  // key in the old selectedDate slot.
  const today = getSportToday(sport ?? null);
  const liveMode = selectedDate >= today;

  const query = useQuery({
    queryKey: queryKeys.weekMatchup(
      leagueId!,
      week?.id,
      teamId ?? undefined,
      liveMode ? "live" : "past",
    ),
    queryFn: () => {
      if (!week || !teamId || !leagueId) return null;
      return fetchWeekMatchupRaw(week, teamId, leagueId, liveMode, sport);
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

  const data = useMemo(
    () =>
      query.data !== undefined
        ? deriveWeekMatchupData(query.data, selectedDate, scoring, sport)
        : undefined,
    [query.data, selectedDate, scoring, sport],
  );

  // Today's view of the same raw fetch, for the week-wide hero score — it
  // must not drift as the day picker moves. Only meaningful when today falls
  // inside the viewed week (the old today-mirror query had the same gate).
  const weekContainsToday =
    !!week && week.start_date <= today && today <= week.end_date;
  const todayData = useMemo(
    () =>
      weekContainsToday && query.data
        ? deriveWeekMatchupData(query.data, today, scoring, sport)
        : null,
    [weekContainsToday, query.data, today, scoring, sport],
  );

  // Picked fields only — spreading the tracked query result would read every
  // getter and subscribe the screen to isFetching/dataUpdatedAt churn.
  return {
    data,
    todayData,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
