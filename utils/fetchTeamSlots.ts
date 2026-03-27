/**
 * Single source of truth for determining which players are on a team
 * and what slot each player is in for a given date.
 *
 * Both the roster page and matchup page must use this function so they
 * always show exactly the same players in exactly the same slots.
 */

import { supabase } from '@/lib/supabase';
import { resolveSlot } from '@/utils/resolveSlot';
import { toDateStr } from '@/utils/dates';

interface DailyEntry {
  lineup_date: string;
  roster_slot: string;
}

export interface TeamSlotData {
  /** Player IDs currently on the roster (in league_players) */
  currentPlayerIds: Set<string>;
  /** Authoritative slot for each player on the requested date */
  slotMap: Map<string, string>;
  /** Players dropped during the week who still have pre-drop activity */
  droppedPlayerIds: string[];
  /** Player ID → acquired date string (YYYY-MM-DD) */
  acquiredDateMap: Map<string, string>;
  /** Player ID → daily lineup entries (sorted desc by date) */
  dailyByPlayer: Map<string, DailyEntry[]>;
  /** Player ID → default roster_slot from league_players */
  defaultSlotMap: Map<string, string>;
}

export async function fetchTeamSlots(
  teamId: string,
  leagueId: string,
  date: string,
  weekBounds?: { start_date: string; end_date: string },
): Promise<TeamSlotData> {
  const today = toDateStr(new Date());

  // Look up week bounds if not provided (roster page doesn't always have them)
  let bounds = weekBounds;
  if (!bounds) {
    const { data: week } = await supabase
      .from('league_schedule')
      .select('start_date, end_date')
      .eq('league_id', leagueId)
      .lte('start_date', date)
      .gte('end_date', date)
      .maybeSingle();
    // Fallback: treat the date as a single-day window
    bounds = week ?? { start_date: date, end_date: date };
  }

  // 1. Fetch current roster + daily lineups in parallel
  const [{ data: leaguePlayers, error: lpErr }, { data: dailyEntries }] = await Promise.all([
    supabase
      .from('league_players')
      .select('player_id, roster_slot, acquired_at')
      .eq('team_id', teamId)
      .eq('league_id', leagueId),
    supabase
      .from('daily_lineups')
      .select('player_id, roster_slot, lineup_date')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .lte('lineup_date', bounds.end_date)
      .order('lineup_date', { ascending: false }),
  ]);

  if (lpErr) throw lpErr;

  // 2. Build lookup structures
  const currentPlayerIds = new Set((leaguePlayers ?? []).map((lp: any) => lp.player_id));

  const defaultSlotMap = new Map<string, string>(
    (leaguePlayers ?? []).map((lp: any) => [lp.player_id, lp.roster_slot ?? 'BE']),
  );

  const acquiredDateMap = new Map<string, string>();
  for (const lp of leaguePlayers ?? []) {
    if ((lp as any).acquired_at) {
      acquiredDateMap.set((lp as any).player_id, toDateStr(new Date((lp as any).acquired_at)));
    }
  }

  // 3. Group daily entries by player (already sorted desc)
  const dailyByPlayer = new Map<string, DailyEntry[]>();
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  // 4. Identify dropped players: in daily_lineups but NOT in league_players,
  //    with a non-DROPPED entry during the week on or before the selected date
  const droppedPlayerIds: string[] = [];
  for (const pid of dailyByPlayer.keys()) {
    if (!currentPlayerIds.has(pid)) {
      const entries = dailyByPlayer.get(pid)!;
      const hasRelevantEntry = entries.some(
        (e) =>
          e.lineup_date >= bounds.start_date &&
          e.lineup_date <= bounds.end_date &&
          e.lineup_date <= date &&
          e.roster_slot !== 'DROPPED',
      );
      if (hasRelevantEntry) droppedPlayerIds.push(pid);
    }
  }

  // 5. Build drop-date map for players no longer on the team
  const dropDateMap = new Map<string, string>();
  for (const pid of droppedPlayerIds) {
    const entries = dailyByPlayer.get(pid) ?? [];
    const droppedEntry = entries.find((e) => e.roster_slot === 'DROPPED');
    if (droppedEntry) {
      dropDateMap.set(pid, droppedEntry.lineup_date);
    }
  }

  // 6. Resolve slot for every player on the requested date
  const slotMap = new Map<string, string>();
  const allPlayerIds = [...currentPlayerIds, ...droppedPlayerIds];

  for (const pid of allPlayerIds) {
    // Skip current roster players for dates before they were acquired —
    // they weren't on this team yet and shouldn't appear at all.
    // UNLESS they have non-DROPPED daily_lineup entries during this week,
    // which means they were on the team in a previous ownership period
    // within the same week (e.g. dropped and re-acquired mid-week).
    const acqDate = acquiredDateMap.get(pid);
    if (currentPlayerIds.has(pid) && acqDate && date < acqDate) {
      const hasWeekEntries = (dailyByPlayer.get(pid) ?? []).some(
        (e) => e.roster_slot !== 'DROPPED' && e.lineup_date >= bounds.start_date && e.lineup_date <= date,
      );
      if (!hasWeekEntries) continue;
    }

    const slot = resolveSlot({
      dailyEntries: dailyByPlayer.get(pid) ?? [],
      day: date,
      defaultSlot: defaultSlotMap.get(pid) ?? 'BE',
      isOnCurrentRoster: currentPlayerIds.has(pid),
      dropDate: dropDateMap.get(pid),
      acquiredDate: acqDate,
      today,
    });
    slotMap.set(pid, slot);
  }

  return {
    currentPlayerIds,
    slotMap,
    droppedPlayerIds,
    acquiredDateMap,
    dailyByPlayer,
    defaultSlotMap,
  };
}
