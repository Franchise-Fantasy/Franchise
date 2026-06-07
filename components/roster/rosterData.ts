import { RosterPlayer } from "@/components/roster/SlotPickerModal";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats, type PlayerGameLog, type ScoringWeight } from "@/types/player";
import { getSportToday } from "@/utils/leagueTime";
import { liveToGameLog, type LivePlayerStats } from "@/utils/nba/nbaLive";
import { type ScheduleEntry } from "@/utils/nba/nbaSchedule";
import { fetchTeamSlots } from "@/utils/roster/fetchTeamSlots";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import {
  calculateAvgFantasyPoints,
  calculateGameFantasyPoints,
} from "@/utils/scoring/fantasyPoints";
import { averageGames, lastNPlayedGames } from "@/utils/scoring/windowAverages";

// Data layer for the roster tab: the per-date roster fetch + the small pure
// stat-line helpers. Split out of (tabs)/roster.tsx so the route file holds
// only the RosterScreen view. Render-neutral — no UI here — so the read-only
// team-roster mirror page is unaffected.

// Per-player game stats fetched for a specific past date
export interface DayGameStats {
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

// Compact stat line shown below player name: "20 PTS · 8 REB · 5 AST"
export function buildStatLine(stats: Record<string, number>): string {
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

// Season averages for rows without a live/final stat line today (pre-game and
// no-game rows), split so the caller can style each piece: `fpts` is the bare
// per-game average (one decimal, e.g. "42.9") shown on the position row, and
// `stats` is the slash-joined box score for the line below. `fpts` is null in
// category leagues (no fantasy points) or with no scoring weights; the whole
// result is null for players with no games logged.
export type SeasonAverages = { stats: string; fpts: string | null };

/** Optional last-N-played-games override for buildSeasonAverages. When set,
 *  the displayed P/R/A and FPTS slice the player's most recent `windowSize`
 *  played games (DNPs skipped) instead of using their season averages — the
 *  picker in PointsStrengthAnalytics + the roster header pill both feed this
 *  so "Last 10" means the same thing across surfaces. Forward-facing only:
 *  callers already gate on `!isLive && !statLine && !isPastDate`, so past
 *  dates and games-in-progress never go through this path. Falls back to
 *  season averages when the player has no game log / no played games in the
 *  window so a fresh acquisition doesn't render as "—". */
export function buildSeasonAverages(
  player: RosterPlayer,
  scoringWeights: ScoringWeight[] | undefined,
  isCategories: boolean,
  windowOverride?: { gameLog: PlayerGameLog[] | undefined; windowSize: number },
): SeasonAverages | null {
  if (windowOverride && windowOverride.windowSize > 0) {
    const played = lastNPlayedGames(windowOverride.gameLog, windowOverride.windowSize);
    if (played.length > 0) {
      const avg = averageGames(played);
      if (avg) {
        const stats = `${avg.avg_pts.toFixed(1)}P/${avg.avg_reb.toFixed(1)}R/${avg.avg_ast.toFixed(1)}A`;
        let fpts: string | null = null;
        if (!isCategories && scoringWeights) {
          let total = 0;
          for (const g of played) total += calculateGameFantasyPoints(g, scoringWeights);
          const value = total / played.length;
          if (value > 0) fpts = value.toFixed(1);
        }
        return { stats, fpts };
      }
    }
    // No game log / no played games — fall through to season averages.
  }

  if ((player.games_played ?? 0) === 0) return null;
  const stats = `${player.avg_pts.toFixed(1)}P/${player.avg_reb.toFixed(1)}R/${player.avg_ast.toFixed(1)}A`;
  let fpts: string | null = null;
  if (!isCategories && scoringWeights) {
    const value = calculateAvgFantasyPoints(player, scoringWeights);
    if (value > 0) fpts = value.toFixed(1);
  }
  return { stats, fpts };
}

export interface SlotStats {
  fpts: number | null;
  statLine: string | null;
  isLive: boolean;
  matchup: string | null;
  gameTimeUtc: string | null;
  /** Past date only: the player's team played but no box-score/live row exists
   *  (injured/inactive — BDL omits non-participants, so no player_games row is
   *  ever written). Lets the row render a "DNP" cue instead of a no-game blank. */
  didNotPlay?: boolean;
}

export interface SlotStatsContext {
  scoringWeights: ScoringWeight[] | undefined;
  isToday: boolean;
  isPastDate: boolean;
  isCategories: boolean;
  liveMap: Map<string, LivePlayerStats>;
  daySchedule: Map<string, ScheduleEntry> | undefined;
  dayGameStats: Map<string, DayGameStats> | undefined;
}

const EMPTY_SLOT_STATS: SlotStats = {
  fpts: null,
  statLine: null,
  isLive: false,
  matchup: null,
  gameTimeUtc: null,
};

// Returns { fpts, statLine, isLive, matchup } for display in a slot row.
// fpts === null means no game on that date — show "—" and exclude from totals.
export function computeSlotStats(
  player: RosterPlayer | null,
  ctx: SlotStatsContext,
): SlotStats {
  const { scoringWeights, isToday, isPastDate, isCategories, liveMap, daySchedule, dayGameStats } =
    ctx;

  if (!player || !scoringWeights) return EMPTY_SLOT_STATS;

  if (isToday) {
    const live = liveMap.get(player.player_id);
    const scheduleEntry = player.nbaTricode
      ? (daySchedule?.get(player.nbaTricode) ?? null)
      : null;
    const todayMatchup = scheduleEntry?.matchup ?? null;
    const todayGameTime = scheduleEntry?.gameTimeUtc ?? null;
    const hasGame = !!live || !!todayMatchup;
    if (!hasGame) return EMPTY_SLOT_STATS;

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
    // Team played but the player has neither a live row nor a player_games row —
    // i.e. injured/inactive. BDL omits non-participants from the box score, so
    // no player_games row is ever written for them. Surface it as DNP using the
    // day's schedule so a played-but-sat day reads "game happened, player out"
    // instead of looking identical to a day the team didn't play.
    // Guard on dayGameStats having loaded (truthy Map) so a player whose
    // player_games row is still in-flight doesn't briefly flash "DNP".
    const schedEntry = player.nbaTricode
      ? (daySchedule?.get(player.nbaTricode) ?? null)
      : null;
    if (schedEntry && dayGameStats) {
      return {
        fpts: null,
        statLine: null,
        isLive: false,
        matchup: schedEntry.matchup,
        gameTimeUtc: null,
        didNotPlay: true,
      };
    }
    return EMPTY_SLOT_STATS;
  }

  // Future — player must have a game that day
  const futureEntry = player.nbaTricode
    ? (daySchedule?.get(player.nbaTricode) ?? null)
    : null;
  const futureMatchup = futureEntry?.matchup ?? null;
  const futureGameTime = futureEntry?.gameTimeUtc ?? null;
  if (!futureMatchup) return EMPTY_SLOT_STATS;
  return {
    fpts: isCategories ? null : 0,
    statLine: null,
    isLive: false,
    matchup: futureMatchup,
    gameTimeUtc: futureGameTime,
  };
}

export function dayToStatRecord(g: DayGameStats): Record<string, number | boolean> {
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

export async function fetchTeamRosterForDate(
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
        promoted_from_taxi: slots.promotedFromTaxiSet.has(pid),
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
      promoted_from_taxi: slots.promotedFromTaxiSet.has(pid),
      acquired_at: slots.acquiredDateMap.get(pid) ?? null,
    } as RosterPlayer;
  });
}
