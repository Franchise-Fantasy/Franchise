import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { RosterPlayer, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { aggregateTeamStats } from '@/utils/categoryScoring';
import { calculateGameFantasyPoints, calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { toDateStr, addDays } from '@/utils/dates';

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
): Promise<{ players: RosterPlayer[]; teamStats: Record<string, number> }> {
  const [{ data: leaguePlayers, error: lpErr }, { data: dailyEntries }] = await Promise.all([
    supabase
      .from('league_players')
      .select('player_id, roster_slot, acquired_at, players(name, position, nba_team, external_id_nba, status)')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .or(`acquired_at.is.null,acquired_at.lte.${selectedDate}T23:59:59.999Z`),
    supabase
      .from('daily_lineups')
      .select('player_id, roster_slot, lineup_date')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .lte('lineup_date', week.end_date)
      .order('lineup_date', { ascending: false }),
  ]);

  if (lpErr) throw lpErr;

  const currentPlayerIds = new Set((leaguePlayers ?? []).map((lp: any) => lp.player_id));

  const defaultSlotMap = new Map<string, string>(
    (leaguePlayers ?? []).map((lp: any) => [lp.player_id, lp.roster_slot ?? 'BE']),
  );

  // Track when each player was acquired so we don't count games from before they joined
  const acquiredDateMap = new Map<string, string>();
  for (const lp of leaguePlayers ?? []) {
    if ((lp as any).acquired_at) {
      acquiredDateMap.set((lp as any).player_id, toDateStr(new Date((lp as any).acquired_at)));
    }
  }

  const dailyByPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string }>>();
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  // Find players who were dropped mid-week (in daily_lineups but not in league_players)
  const droppedPlayerIds: string[] = [];
  for (const pid of dailyByPlayer.keys()) {
    if (!currentPlayerIds.has(pid)) {
      const entries = dailyByPlayer.get(pid)!;
      const hasWeekEntry = entries.some(
        (e) => e.lineup_date >= week.start_date && e.lineup_date <= week.end_date,
      );
      if (hasWeekEntry) droppedPlayerIds.push(pid);
    }
  }

  // Combine current + dropped player IDs for game log queries
  const allPlayerIds = [...currentPlayerIds, ...droppedPlayerIds];
  if (allPlayerIds.length === 0) return { players: [], teamStats: {} };

  const today = toDateStr(new Date());

  // Build a map of drop dates for players no longer on the team
  const dropDateMap = new Map<string, string>();
  for (const pid of droppedPlayerIds) {
    const entries = dailyByPlayer.get(pid) ?? [];
    const droppedEntry = entries.find((e) => e.roster_slot === 'DROPPED');
    if (droppedEntry) {
      dropDateMap.set(pid, droppedEntry.lineup_date);
    }
  }

  const resolveSlot = (playerId: string, day: string): string => {
    // For players no longer on this team, enforce DROPPED after their drop date
    if (!currentPlayerIds.has(playerId)) {
      const dropDate = dropDateMap.get(playerId);
      if (dropDate && day >= dropDate) return 'DROPPED';
      // No DROPPED marker but player isn't on team — treat today onward as DROPPED
      if (!dropDate && day >= today) return 'DROPPED';
    }

    const entries = dailyByPlayer.get(playerId) ?? [];
    const entry = entries.find((e) => e.lineup_date <= day);
    if (entry) return entry.roster_slot;
    // No daily_lineup entry — fall back to current slot, but only if the player
    // was on this team by the game date (prevents counting pre-acquisition games)
    const acquired = acquiredDateMap.get(playerId);
    if (acquired && day < acquired) return 'BE';
    return defaultSlotMap.get(playerId) ?? 'BE';
  };

  // Fetch past game logs, season stats, and dropped player info in parallel
  const weekEndForQuery = selectedDate >= today ? addDays(today, -1) : week.end_date;

  const [{ data: gameLogs }, { data: seasonStats }, droppedPlayerInfo] = await Promise.all([
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
    (async () => {
      if (droppedPlayerIds.length === 0) return new Map<string, any>();
      const { data: droppedPlayers } = await supabase
        .from('players')
        .select('id, name, position, nba_team, external_id_nba, status')
        .in('id', droppedPlayerIds);
      const map = new Map<string, any>();
      for (const p of droppedPlayers ?? []) map.set(p.id, p);
      return map;
    })(),
  ]);

  const weekPointsMap = new Map<string, number>();
  const dayPointsMap = new Map<string, number>();
  const dayMatchupMap = new Map<string, string>();
  const dayStatsMap = new Map<string, Record<string, number>>();
  const activeGames: Record<string, any>[] = [];

  for (const game of gameLogs ?? []) {
    const slot = resolveSlot(game.player_id, game.game_date);
    if (slot === 'BE' || slot === 'IR' || slot === 'DROPPED') continue;

    activeGames.push(game);
    const fp = calculateGameFantasyPoints(game as any, scoring);
    weekPointsMap.set(game.player_id, (weekPointsMap.get(game.player_id) ?? 0) + fp);

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
    projMap.set(ps.player_id, calculateAvgFantasyPoints(ps as any, scoring));
  }

  // Build roster player list from current players
  const rosterPlayers: RosterPlayer[] = (leaguePlayers ?? []).map((lp: any) => ({
    player_id: lp.player_id,
    name: lp.players?.name ?? '—',
    position: lp.players?.position ?? '—',
    nba_team: lp.players?.nba_team ?? '—',
    external_id_nba: lp.players?.external_id_nba ?? null,
    status: lp.players?.status ?? 'active',
    nbaTricode: (() => {
      const t = lp.players?.nba_team ?? '';
      return t && t !== 'Active' && t !== 'Inactive' ? t : null;
    })(),
    roster_slot: resolveSlot(lp.player_id, selectedDate),
    weekPoints: round1(weekPointsMap.get(lp.player_id) ?? 0),
    dayPoints: round1(dayPointsMap.get(lp.player_id) ?? 0),
    dayMatchup: dayMatchupMap.get(lp.player_id) ?? null,
    dayStatLine: (() => {
      const ds = dayStatsMap.get(lp.player_id);
      return ds ? buildStatLine(ds, scoring) : null;
    })(),
    projectedFpts: (() => {
      const st = lp.players?.status;
      if (st === 'OUT' || st === 'Suspended') return 0;
      return projMap.get(lp.player_id) ?? null;
    })(),
  }));

  // Add dropped players — always include them so their past weekPoints count toward
  // the team total. Players whose slot is DROPPED for the selected date still appear
  // in the list (with roster_slot 'DROPPED') so the UI can render them appropriately.
  for (const pid of droppedPlayerIds) {
    const droppedSlot = resolveSlot(pid, selectedDate);
    const info = droppedPlayerInfo.get(pid);
    const t = info?.nba_team ?? '';
    rosterPlayers.push({
      player_id: pid,
      name: info?.name ?? '—',
      position: info?.position ?? '—',
      nba_team: t,
      external_id_nba: info?.external_id_nba ?? null,
      status: info?.status ?? 'active',
      nbaTricode: t && t !== 'Active' && t !== 'Inactive' ? t : null,
      roster_slot: droppedSlot,
      weekPoints: round1(weekPointsMap.get(pid) ?? 0),
      dayPoints: round1(dayPointsMap.get(pid) ?? 0),
      dayMatchup: dayMatchupMap.get(pid) ?? null,
      dayStatLine: (() => {
        const ds = dayStatsMap.get(pid);
        return ds ? buildStatLine(ds, scoring) : null;
      })(),
      projectedFpts: 0,
    });
  }

  return { players: rosterPlayers, teamStats };
}
