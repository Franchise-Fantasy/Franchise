import { RosterPlayer, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { addDays } from '@/utils/dates';
import { getSportToday } from '@/utils/leagueTime';
import {
  fetchTeamSlotsRaw,
  resolveTeamSlotsForDate,
  type TeamSlotsRaw,
} from '@/utils/roster/fetchTeamSlots';
import { resolveSlot , isActiveSlot } from '@/utils/roster/resolveSlot';
import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';
import { aggregateTeamStats } from '@/utils/scoring/categoryScoring';
import { calculateGameFantasyPoints, calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';
import { NFL_GAME_COLUMNS } from '@/utils/scoring/nflStatLine';
import { isWeeklyLineupSport } from '@/utils/sports/registry';


interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

// Bench/IR/DROPPED players show their own per-game fpts on their cell, but
// those points don't count toward the team's day total. Starter slots include
// any positional slot (PG, SG, F, C, UTIL, etc.).
export function sumStarterDayPoints(players: RosterPlayer[]): number {
  return players.reduce((s, p) => {
    const slot = p.roster_slot;
    const isStarter =
      !!slot && slot !== 'BE' && slot !== 'IR' && slot !== ROSTER_SLOT.DROPPED;
    return isStarter ? s + p.dayPoints : s;
  }, 0);
}

/** Date-independent fetched state for one team's week. Derive per-day views
 *  with deriveTeamDayData — no further round trips per day swipe. */
export interface TeamWeekRaw {
  slotsRaw: TeamSlotsRaw;
  gameLogs: any[];
  seasonStats: any[];
  playerInfoRows: any[];
}

/** The query half of fetchTeamData. `liveMode` = the viewer is on today or a
 *  future day: game logs stop at yesterday (today's points come from the live
 *  stats poller, not player_games). Past-day views take the whole week. */
export async function fetchTeamWeekData(
  teamId: string,
  leagueId: string,
  week: Week,
  liveMode: boolean,
  sport?: string | null,
): Promise<TeamWeekRaw> {
  const today = getSportToday(sport ?? null);
  const slotsRaw = await fetchTeamSlotsRaw(teamId, leagueId, week, sport);

  // Anyone who can appear in this week's views — current roster plus players
  // dropped mid-week (their pre-drop games still count). This is the
  // date-independent superset of every per-day droppedPlayerIds set
  // resolveTeamSlotsForDate can produce for a date inside the week.
  const allPlayerIds = [...slotsRaw.currentPlayerIds];
  for (const [pid, entries] of slotsRaw.dailyByPlayer) {
    if (slotsRaw.currentPlayerIds.has(pid)) continue;
    const relevant = entries.some(
      (e) =>
        e.lineup_date >= week.start_date &&
        e.lineup_date <= week.end_date &&
        e.roster_slot !== ROSTER_SLOT.DROPPED,
    );
    if (relevant) allPlayerIds.push(pid);
  }
  if (allPlayerIds.length === 0)
    return { slotsRaw, gameLogs: [], seasonStats: [], playerInfoRows: [] };

  const weekEndForQuery = liveMode ? addDays(today, -1) : week.end_date;

  // One literal select covers both sports — the other sport's columns come
  // back null and are skipped everywhere (a dynamic per-sport string would
  // break supabase-js's select-string type parser).
  const [{ data: gameLogs }, { data: seasonStats }, { data: playerInfoRows }] = await Promise.all([
    supabase
      .from('player_games')
      .select(
        'player_id, min, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, pass_cmp, pass_att, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec, targets, rec_yd, rec_td, fum_lost, ret_td, fg_made, fg_att, xp_made, dst_sacks, dst_int, dst_fum_rec, dst_td, dst_pts_allowed, dst_pa_pts, game_date, matchup',
      )
      .in('player_id', allPlayerIds)
      .gte('game_date', week.start_date)
      .lte('game_date', weekEndForQuery),
    supabase
      .from('player_season_stats')
      .select(
        'player_id, games_played, total_pts, total_reb, total_ast, total_stl, total_blk, total_tov, total_fgm, total_fga, total_3pm, total_3pa, total_ftm, total_fta, total_pf, total_dd, total_td, total_pass_yd, total_pass_td, total_pass_int, total_rush_yd, total_rush_td, total_rec, total_rec_yd, total_rec_td, total_fum_lost, total_ret_td, total_fg_made, total_xp_made, total_dst_sacks, total_dst_int, total_dst_fum_rec, total_dst_td, total_dst_pa_pts',
      )
      .in('player_id', allPlayerIds),
    supabase
      .from('players')
      .select('id, name, position, pro_team, external_id_nba, status')
      .in('id', allPlayerIds),
  ]);

  return {
    slotsRaw,
    gameLogs: gameLogs ?? [],
    seasonStats: seasonStats ?? [],
    playerInfoRows: playerInfoRows ?? [],
  };
}

/** The pure half — build one day's view from a week's raw fetch. */
export function deriveTeamDayData(
  raw: TeamWeekRaw,
  week: Week,
  selectedDate: string,
  scoring: ScoringWeight[],
  sport?: string | null,
): {
  players: RosterPlayer[];
  droppedPlayers: RosterPlayer[];
  teamStats: Record<string, number>;
  weekTotalAll: number;
} {
  // Slate-anchored "today" so day-boundary logic agrees across viewers.
  const today = getSportToday(sport ?? null);

  // Use the shared slot resolution — same function the roster page uses
  const slots = resolveTeamSlotsForDate(raw.slotsRaw, selectedDate, week, sport);

  const allPlayerIds = [...slots.currentPlayerIds, ...slots.droppedPlayerIds];
  if (allPlayerIds.length === 0)
    return { players: [], droppedPlayers: [], teamStats: {}, weekTotalAll: 0 };

  // Build drop-date map for per-game slot resolution
  const dropDateMap = new Map<string, string>();
  for (const pid of slots.droppedPlayerIds) {
    const entries = slots.dailyByPlayer.get(pid) ?? [];
    const droppedEntry = entries.find((e) => e.roster_slot === ROSTER_SLOT.DROPPED);
    if (droppedEntry) dropDateMap.set(pid, droppedEntry.lineup_date);
  }

  const resolveGameSlotFast = (playerId: string, day: string): string =>
    resolveSlot({
      dailyEntries: slots.dailyByPlayer.get(playerId) ?? [],
      day,
      defaultSlot: slots.defaultSlotMap.get(playerId) ?? 'BE',
      isOnCurrentRoster: slots.currentPlayerIds.has(playerId),
      dropDate: dropDateMap.get(playerId),
      acquiredDate: slots.acquiredDateMap.get(playerId),
      today,
    });

  const { seasonStats } = raw;

  // Two guards that restore the exact row set the old per-date fetch produced:
  //
  // (a) A live view (selectedDate on/after today) must NEVER count today's
  //     player_games rows — today's production arrives via the live stats
  //     poller and is added on top as a live bonus, so a today row that
  //     already went final in player_games would be double-counted. The old
  //     live-mode fetch stopped at yesterday; a past-mode raw doesn't, so
  //     filter here. (No-op on live-mode raws.)
  //
  // (b) Only players in THIS date's roster/dropped set may contribute — the
  //     week-wide fetch superset can include add/drop stints entirely after
  //     the viewed date, whose games the old code never fetched (they'd leak
  //     into category teamStats).
  const viewIsLive = selectedDate >= today;
  const perDateIds = new Set(allPlayerIds);
  const gameLogs = raw.gameLogs.filter(
    (g) => perDateIds.has(g.player_id) && (!viewIsLive || g.game_date < today),
  );

  // Build player info map
  const playerInfoMap = new Map<string, any>();
  for (const p of raw.playerInfoRows) playerInfoMap.set(p.id, p);

  const weekPointsMap = new Map<string, number>();
  const weekGamesMap = new Map<string, number>();
  const weekStatsMap = new Map<string, Record<string, number>>();
  const dayPointsMap = new Map<string, number>();
  const dayMatchupMap = new Map<string, string>();
  const dayStatsMap = new Map<string, Record<string, number>>();
  const activeGames: Record<string, any>[] = [];

  const weekStatKeys: readonly string[] =
    sport === 'nfl'
      ? NFL_GAME_COLUMNS
      : ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', '3pm', '3pa', 'ftm', 'fta', 'pf', 'double_double', 'triple_double'];

  for (const game of gameLogs ?? []) {
    const slot = resolveGameSlotFast(game.player_id, game.game_date as string);
    const slotIsActive = isActiveSlot(slot);
    const fp = calculateGameFantasyPoints(game as any, scoring, sport);

    if (slotIsActive) {
      activeGames.push(game);
      weekPointsMap.set(game.player_id, (weekPointsMap.get(game.player_id) ?? 0) + fp);
      // Only count games the player actually appeared in — player_games keeps
      // 0-minute DNP rows, which shouldn't count as "games played" or scale
      // the season-average expectation.
      if ((game.min ?? 0) > 0) {
        weekGamesMap.set(game.player_id, (weekGamesMap.get(game.player_id) ?? 0) + 1);
      }

      // Accumulate per-player weekly stat totals for summary modal
      const existing = weekStatsMap.get(game.player_id) ?? {};
      for (const key of weekStatKeys) {
        const val = (game as Record<string, any>)[key];
        if (val != null) {
          const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : val;
          existing[key] = (existing[key] ?? 0) + numVal;
        }
      }
      weekStatsMap.set(game.player_id, existing);
    }

    // Always populate per-day display data — bench/IR players show their stat
    // line, matchup chip, and own fpts even though those points don't roll up
    // into the team's day/week total (filtered downstream by roster_slot).
    // Weekly sports (NFL) show the week's single game regardless of the pinned
    // anchor day — gameLogs are already week-bounded and there's ≤1 game/player.
    if (isWeeklyLineupSport(sport) || game.game_date === selectedDate) {
      dayPointsMap.set(game.player_id, (dayPointsMap.get(game.player_id) ?? 0) + fp);
      if (game.matchup) dayMatchupMap.set(game.player_id, game.matchup);
      if (sport === 'nfl') {
        const ds: Record<string, number> = {};
        for (const key of NFL_GAME_COLUMNS) {
          const val = (game as Record<string, any>)[key];
          if (val != null) ds[key] = val;
        }
        dayStatsMap.set(game.player_id, ds);
      } else {
        dayStatsMap.set(game.player_id, {
          pts: game.pts,
          reb: game.reb,
          ast: game.ast,
          stl: game.stl,
          blk: game.blk,
          tov: game.tov,
          fgm: game.fgm,
          fga: game.fga,
          '3pm': game['3pm'],
          ftm: game.ftm,
          fta: game.fta,
          pf: game.pf,
        });
      }
    }
  }

  const teamStats = aggregateTeamStats(activeGames);

  const projMap = new Map<string, number>();
  for (const ps of seasonStats ?? []) {
    projMap.set(ps.player_id as string, calculateAvgFantasyPoints(ps as any, scoring, sport));
  }

  // Build roster player list — use slotMap from fetchTeamSlots for display slot
  const rosterPlayers: RosterPlayer[] = allPlayerIds.map((pid) => {
    const info = playerInfoMap.get(pid);
    const t = info?.pro_team ?? '';
    const nbaTricode = t && t !== 'Active' && t !== 'Inactive' ? t : null;
    const displaySlot = slots.slotMap.get(pid) ?? 'BE';
    const isDropped = !slots.currentPlayerIds.has(pid);

    return {
      player_id: pid,
      name: info?.name ?? '—',
      position: info?.position ?? '—',
      pro_team: t,
      external_id_nba: info?.external_id_nba ?? null,
      status: info?.status ?? 'active',
      nbaTricode,
      roster_slot: displaySlot,
      weekPoints: round1(weekPointsMap.get(pid) ?? 0),
      weekGames: weekGamesMap.get(pid) ?? 0,
      // Raw per-game season average — unlike projectedFpts it's NOT zeroed
      // for dropped/OUT players, so the weekly summary can still compute a
      // vs-expected baseline for the games they did play.
      seasonAvgFpts: projMap.get(pid) ?? null,
      dayPoints: round1(dayPointsMap.get(pid) ?? 0),
      dayMatchup: dayMatchupMap.get(pid) ?? null,
      dayStatLine: (() => {
        const ds = dayStatsMap.get(pid);
        return ds ? buildStatLine(ds, scoring, sport) : null;
      })(),
      // Raw per-day box score — feeds the matchup cell's stat blocks + the
      // FPTS breakdown. Without this the past-day blocks render all zeros.
      dayGameStats: dayStatsMap.get(pid) ?? null,
      projectedFpts: (() => {
        if (isDropped) return 0;
        const st = info?.status;
        if (st === 'OUT' || st === 'Suspended') return 0;
        return projMap.get(pid) ?? null;
      })(),
      weekGameStats: weekStatsMap.get(pid) ?? null,
    };
  });

  // Compute weekTotal from ALL players (including dropped) so pre-trade points are counted
  const weekTotalAll = round1(rosterPlayers.reduce((s, p) => s + p.weekPoints, 0));

  // Split the roster for the caller:
  // - droppedPlayers: kept out of the matchup board, but the weekly summary
  //   still credits the points they scored before being dropped.
  // - visiblePlayers: shown on the board. Excludes DROPPED, and excludes
  //   BE players acquired after this date (weren't on the team yet).
  const droppedPlayers = rosterPlayers.filter((p) => p.roster_slot === ROSTER_SLOT.DROPPED);
  const visiblePlayers = rosterPlayers.filter((p) => {
    if (p.roster_slot === ROSTER_SLOT.DROPPED) return false;
    if (p.roster_slot !== 'BE') return true;
    const acquired = slots.acquiredDateMap.get(p.player_id);
    if (acquired && selectedDate < acquired) return false;
    return true;
  });

  return { players: visiblePlayers, droppedPlayers, teamStats, weekTotalAll };
}

/** Fetch + derive in one call (the original API). Prefer the week-raw/derive
 *  pair when the caller re-derives multiple dates within one week. */
export async function fetchTeamData(
  teamId: string,
  leagueId: string,
  week: Week,
  selectedDate: string,
  scoring: ScoringWeight[],
  sport?: string | null,
): Promise<{
  players: RosterPlayer[];
  droppedPlayers: RosterPlayer[];
  teamStats: Record<string, number>;
  weekTotalAll: number;
}> {
  const today = getSportToday(sport ?? null);
  const raw = await fetchTeamWeekData(teamId, leagueId, week, selectedDate >= today, sport);
  return deriveTeamDayData(raw, week, selectedDate, scoring, sport);
}
