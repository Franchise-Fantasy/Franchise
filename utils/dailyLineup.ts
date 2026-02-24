import { supabase } from '@/lib/supabase';

// Returns a map of player_id → roster_slot for the given date.
// Uses rollover: if no entry exists for the date, uses the most recent prior entry.
// Falls back to league_players.roster_slot for players with no daily_lineups history.
export async function fetchLineupForDate(
  teamId: string,
  leagueId: string,
  date: string // 'YYYY-MM-DD'
): Promise<Map<string, string>> {
  const [{ data: dailyEntries }, { data: leaguePlayers }] = await Promise.all([
    supabase
      .from('daily_lineups')
      .select('player_id, roster_slot, lineup_date')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .lte('lineup_date', date)
      .order('lineup_date', { ascending: false }),
    supabase
      .from('league_players')
      .select('player_id, roster_slot')
      .eq('team_id', teamId)
      .eq('league_id', leagueId),
  ]);

  const slotMap = new Map<string, string>();

  // Most recent daily_lineups entry per player (entries are sorted desc by date)
  for (const entry of dailyEntries ?? []) {
    if (!slotMap.has(entry.player_id)) {
      slotMap.set(entry.player_id, entry.roster_slot);
    }
  }

  // Fallback: players with no daily_lineups entry use league_players.roster_slot
  for (const lp of leaguePlayers ?? []) {
    if (!slotMap.has(lp.player_id)) {
      slotMap.set(lp.player_id, lp.roster_slot ?? 'BE');
    }
  }

  return slotMap;
}
