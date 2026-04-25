import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { RosterPlayer, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { aggregateTeamStats } from '@/utils/categoryScoring';
import { calculateGameFantasyPoints, calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { toDateStr, addDays } from '@/utils/dates';
import { fetchTeamSlots } from '@/utils/fetchTeamSlots';
import { resolveSlot } from '@/utils/resolveSlot';
import { isActiveSlot } from '@/utils/resolveSlot';

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

export async function fetchTeamData(
  teamId: string,
  leagueId: string,
  week: Week,
  selectedDate: string,
  scoring: ScoringWeight[],
): Promise<{ players: RosterPlayer[]; teamStats: Record<string, number>; weekTotalAll: number }> {
  const today = toDateStr(new Date());

  // Use the shared slot resolution — same function the roster page uses
  const slots = await fetchTeamSlots(teamId, leagueId, selectedDate, week);

  const allPlayerIds = [...slots.currentPlayerIds, ...slots.droppedPlayerIds];
  if (allPlayerIds.length === 0) return { players: [], teamStats: {}, weekTotalAll: 0 };

  // Build drop-date map for per-game slot resolution
  const dropDateMap = new Map<string, string>();
  for (const pid of slots.droppedPlayerIds) {
    const entries = slots.dailyByPlayer.get(pid) ?? [];
    const droppedEntry = entries.find((e) => e.roster_slot === 'DROPPED');
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

  // Fetch game logs, season stats, and dropped player info in parallel
  const weekEndForQuery = selectedDate >= today ? addDays(today, -1) : week.end_date;

  const [{ data: gameLogs }, { data: seasonStats }, { data: playerInfoRows }] = await Promise.all([
    supabase
      .from('player_games')
      .select(
        'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date, matchup',
      )
      .in('player_id', allPlayerIds)
      .gte('game_date', week.start_date)
      .lte('game_date', weekEndForQuery),
    supabase
      .from('player_season_stats')
      .select(
        'player_id, games_played, total_pts, total_reb, total_ast, total_stl, total_blk, total_tov, total_fgm, total_fga, total_3pm, total_3pa, total_ftm, total_fta, total_pf, total_dd, total_td',
      )
      .in('player_id', allPlayerIds),
    supabase
      .from('players')
      .select('id, name, position, pro_team, external_id_nba, status')
      .in('id', allPlayerIds),
  ]);

  // Build player info map
  const playerInfoMap = new Map<string, any>();
  for (const p of playerInfoRows ?? []) playerInfoMap.set(p.id, p);

  const weekPointsMap = new Map<string, number>();
  const weekStatsMap = new Map<string, Record<string, number>>();
  const dayPointsMap = new Map<string, number>();
  const dayMatchupMap = new Map<string, string>();
  const dayStatsMap = new Map<string, Record<string, number>>();
  const activeGames: Record<string, any>[] = [];

  for (const game of gameLogs ?? []) {
    const slot = resolveGameSlotFast(game.player_id, game.game_date as string);
    if (!isActiveSlot(slot)) continue;

    activeGames.push(game);
    const fp = calculateGameFantasyPoints(game as any, scoring);
    weekPointsMap.set(game.player_id, (weekPointsMap.get(game.player_id) ?? 0) + fp);

    // Accumulate per-player weekly stat totals for summary modal
    const existing = weekStatsMap.get(game.player_id) ?? {};
    for (const key of ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', '3pm', '3pa', 'ftm', 'fta', 'pf', 'double_double', 'triple_double'] as const) {
      const val = game[key];
      if (val != null) {
        const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : val;
        existing[key] = (existing[key] ?? 0) + numVal;
      }
    }
    weekStatsMap.set(game.player_id, existing);

    if (game.game_date === selectedDate) {
      dayPointsMap.set(game.player_id, (dayPointsMap.get(game.player_id) ?? 0) + fp);
      if (game.matchup) dayMatchupMap.set(game.player_id, game.matchup);
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

  const teamStats = aggregateTeamStats(activeGames);

  const projMap = new Map<string, number>();
  for (const ps of seasonStats ?? []) {
    projMap.set(ps.player_id as string, calculateAvgFantasyPoints(ps as any, scoring));
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
      dayPoints: round1(dayPointsMap.get(pid) ?? 0),
      dayMatchup: dayMatchupMap.get(pid) ?? null,
      dayStatLine: (() => {
        const ds = dayStatsMap.get(pid);
        return ds ? buildStatLine(ds, scoring) : null;
      })(),
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

  // Filter out players who shouldn't be visible on this date:
  // - DROPPED players: not shown in roster but their points are included in weekTotalAll
  // - Players with no real slot (BE) who were acquired after this date: weren't on team yet
  const visiblePlayers = rosterPlayers.filter((p) => {
    if (p.roster_slot === 'DROPPED') return false;
    if (p.roster_slot !== 'BE') return true;
    const acquired = slots.acquiredDateMap.get(p.player_id);
    if (acquired && selectedDate < acquired) return false;
    return true;
  });

  return { players: visiblePlayers, teamStats, weekTotalAll };
}
