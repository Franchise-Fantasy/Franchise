// Bulk data loader for finalize-week. The legacy version called
// `fetchTeamRosterAndGames` once per team per matchup — for an N-matchup
// batch across L leagues, that's 4 × 2N DB roundtrips. This version takes
// the full list of (team, league, schedule) tuples up front and runs 4
// queries TOTAL regardless of batch size, indexed by team_id for O(1)
// per-team lookup at compute time.
//
// Returned `TeamData` is the same shape `fetchTeamRosterAndGames` used to
// return — drop-in for the existing per-team scoring functions.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import type { Database } from '../../../../types/database.types.ts';

export interface TeamData {
  allPlayerIds: string[];
  currentPlayerIds: Set<string>;
  defaultSlotMap: Map<string, string>;
  acquiredDateMap: Map<string, string>;
  dropDateMap: Map<string, string>;
  dailyByPlayer: Map<string, Array<{ lineup_date: string; roster_slot: string }>>;
  gameLogs: Array<Record<string, unknown>>;
  playerInfo: Map<string, {
    name: string;
    position: string | null;
    pro_team: string | null;
    external_id_nba: string | null;
  }>;
}

export interface MatchupTeamRef {
  teamId: string;
  leagueId: string;
  startDate: string;
  endDate: string;
}

/**
 * Convert a Postgres timestamp string to a YYYY-MM-DD using local Date
 * components — matches the format the rest of the function uses for slot
 * resolution comparisons.
 */
function ymdFromTimestamp(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Run 4 bulk queries to load every team's roster, lineups, game logs, and
 * player info needed to compute scores for the given batch of (team, week)
 * tuples. Returns a Map keyed by `${teamId}:${startDate}:${endDate}` so a
 * team appearing in multiple weeks (rare but possible) is keyed cleanly.
 */
export async function loadTeamDataBatch(
  supabase: SupabaseClient<Database>,
  refs: MatchupTeamRef[],
): Promise<Map<string, TeamData>> {
  if (refs.length === 0) return new Map();

  const teamIds = [...new Set(refs.map((r) => r.teamId))];
  const leagueIds = [...new Set(refs.map((r) => r.leagueId))];

  // The widest date range that covers every (team, week) in the batch. We
  // over-fetch a bit (a team scoped to week 5 also pulls week 6 lineups if
  // another team in the batch is on week 6) but pay one query instead of N.
  const minStart = refs.reduce((acc, r) => (r.startDate < acc ? r.startDate : acc), refs[0].startDate);
  const maxEnd = refs.reduce((acc, r) => (r.endDate > acc ? r.endDate : acc), refs[0].endDate);

  // 1. All current rosters across all teams.
  const { data: rosterRows } = await supabase
    .from('league_players')
    .select('player_id, team_id, league_id, roster_slot, acquired_at')
    .in('team_id', teamIds)
    .in('league_id', leagueIds);

  // 2. All daily_lineups for those teams within the batch's date window.
  const { data: lineupRows } = await supabase
    .from('daily_lineups')
    .select('player_id, team_id, league_id, roster_slot, lineup_date')
    .in('team_id', teamIds)
    .in('league_id', leagueIds)
    .lte('lineup_date', maxEnd);

  // Collect every player_id we'll need stats for: current rosters + historical
  // (people who appeared in daily_lineups during this window but are no longer
  // rostered — they could still contribute pre-drop fpts).
  const allPlayerIds = new Set<string>();
  for (const r of rosterRows ?? []) allPlayerIds.add(r.player_id);
  for (const l of lineupRows ?? []) allPlayerIds.add(l.player_id);
  const playerIdList = [...allPlayerIds];

  // 3 + 4. Game logs (in date range) + player info, in parallel.
  const [{ data: gameRows }, { data: playerRows }] = await Promise.all([
    playerIdList.length > 0
      ? supabase
          .from('player_games')
          .select(
            'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date, matchup',
          )
          .in('player_id', playerIdList)
          .gte('game_date', minStart)
          .lte('game_date', maxEnd)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    playerIdList.length > 0
      ? supabase
          .from('players')
          .select('id, name, position, pro_team, external_id_nba')
          .in('id', playerIdList)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; position: string | null; pro_team: string | null; external_id_nba: string | null }> }),
  ]);

  // Index everything by team_id (and player_id where needed) so per-team
  // assembly below is O(1) per row.
  const rostersByTeam = new Map<string, typeof rosterRows>();
  for (const r of rosterRows ?? []) {
    if (!rostersByTeam.has(r.team_id)) rostersByTeam.set(r.team_id, [] as never);
    rostersByTeam.get(r.team_id)!.push(r);
  }

  const lineupsByTeamPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string }>>();
  const lineupsByTeam = new Map<string, Array<{ player_id: string; lineup_date: string; roster_slot: string }>>();
  for (const l of lineupRows ?? []) {
    const teamKey = l.team_id;
    if (!lineupsByTeam.has(teamKey)) lineupsByTeam.set(teamKey, []);
    lineupsByTeam.get(teamKey)!.push({ player_id: l.player_id, lineup_date: l.lineup_date, roster_slot: l.roster_slot ?? 'BE' });
    const k = `${teamKey}|${l.player_id}`;
    if (!lineupsByTeamPlayer.has(k)) lineupsByTeamPlayer.set(k, []);
    lineupsByTeamPlayer.get(k)!.push({ lineup_date: l.lineup_date, roster_slot: l.roster_slot ?? 'BE' });
  }
  // Sort each per-(team, player) bucket by date descending — matches the
  // legacy query's ORDER BY and is what resolveSlot expects.
  for (const arr of lineupsByTeamPlayer.values()) {
    arr.sort((a, b) => (a.lineup_date > b.lineup_date ? -1 : a.lineup_date < b.lineup_date ? 1 : 0));
  }

  const gamesByPlayer = new Map<string, Array<Record<string, unknown>>>();
  for (const g of gameRows ?? []) {
    const pid = g.player_id as string;
    if (!gamesByPlayer.has(pid)) gamesByPlayer.set(pid, []);
    gamesByPlayer.get(pid)!.push(g as Record<string, unknown>);
  }

  const playerInfoByPid = new Map<string, TeamData['playerInfo'] extends Map<string, infer V> ? V : never>();
  for (const p of playerRows ?? []) {
    playerInfoByPid.set(p.id, {
      name: p.name,
      position: p.position,
      pro_team: p.pro_team,
      external_id_nba: p.external_id_nba,
    });
  }

  // Assemble per-team TeamData scoped to its own (start, end) window.
  const out = new Map<string, TeamData>();

  for (const ref of refs) {
    const teamRoster = rostersByTeam.get(ref.teamId) ?? [];
    const currentPlayerIds = new Set(teamRoster.map((lp) => lp.player_id));
    const defaultSlotMap = new Map<string, string>(
      teamRoster.map((lp) => [lp.player_id, lp.roster_slot ?? 'BE']),
    );
    const acquiredDateMap = new Map<string, string>();
    for (const lp of teamRoster) {
      if (lp.acquired_at) acquiredDateMap.set(lp.player_id, ymdFromTimestamp(lp.acquired_at));
    }

    // Players who appeared in lineups during the window but aren't on the
    // current roster — historical / dropped. dropDate is the first DROPPED
    // entry on or after startDate.
    const teamLineups = lineupsByTeam.get(ref.teamId) ?? [];
    const droppedPlayerIds: string[] = [];
    const dropDateMap = new Map<string, string>();
    const seenHistorical = new Set<string>();
    for (const entry of teamLineups) {
      if (currentPlayerIds.has(entry.player_id)) continue;
      if (entry.lineup_date < ref.startDate) continue;
      if (!seenHistorical.has(entry.player_id)) {
        seenHistorical.add(entry.player_id);
        droppedPlayerIds.push(entry.player_id);
      }
    }
    for (const pid of droppedPlayerIds) {
      const entries = lineupsByTeamPlayer.get(`${ref.teamId}|${pid}`) ?? [];
      const dropped = entries.find((e) => e.roster_slot === 'DROPPED');
      if (dropped) dropDateMap.set(pid, dropped.lineup_date);
    }

    const teamPlayerIds = [...currentPlayerIds, ...droppedPlayerIds];

    // Per-player lineup history (limited to this team's bucket, descending date).
    const dailyByPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string }>>();
    for (const pid of teamPlayerIds) {
      const entries = lineupsByTeamPlayer.get(`${ref.teamId}|${pid}`) ?? [];
      dailyByPlayer.set(pid, entries);
    }

    // Per-player game logs scoped to this team's window.
    const teamGames: Array<Record<string, unknown>> = [];
    for (const pid of teamPlayerIds) {
      const games = gamesByPlayer.get(pid) ?? [];
      for (const g of games) {
        const d = g.game_date as string | null;
        if (!d) continue;
        if (d >= ref.startDate && d <= ref.endDate) teamGames.push(g);
      }
    }

    const playerInfo = new Map<string, TeamData['playerInfo'] extends Map<string, infer V> ? V : never>();
    for (const pid of teamPlayerIds) {
      const info = playerInfoByPid.get(pid);
      if (info) playerInfo.set(pid, info);
    }

    out.set(`${ref.teamId}:${ref.startDate}:${ref.endDate}`, {
      allPlayerIds: teamPlayerIds,
      currentPlayerIds,
      defaultSlotMap,
      acquiredDateMap,
      dropDateMap,
      dailyByPlayer,
      gameLogs: teamGames,
      playerInfo,
    });
  }

  return out;
}

/** Build the key into the TeamData map for a given ref. */
export function teamDataKey(teamId: string, startDate: string, endDate: string): string {
  return `${teamId}:${startDate}:${endDate}`;
}
