import { supabase } from '@/lib/supabase';

// Returns a map of player_id → roster_slot for the given date.
// Uses rollover: if no entry exists for the date, uses the most recent prior entry.
// Falls back to league_players.roster_slot for players with no daily_lineups history.
// Also includes dropped players who have daily_lineups entries (preserves mid-week drops).
export async function fetchLineupForDate(
  teamId: string,
  leagueId: string,
  date: string // 'YYYY-MM-DD'
): Promise<Map<string, string>> {
  // Scope to last 30 days for performance; fallback to league_players handles older players
  const lookbackDate = new Date(date);
  lookbackDate.setDate(lookbackDate.getDate() - 30);
  const lookbackStr = lookbackDate.toISOString().slice(0, 10);

  const [{ data: dailyEntries }, { data: leaguePlayers }] = await Promise.all([
    supabase
      .from('daily_lineups')
      .select('player_id, roster_slot, lineup_date')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .gte('lineup_date', lookbackStr)
      .lte('lineup_date', date)
      .order('lineup_date', { ascending: false }),
    supabase
      .from('league_players')
      .select('player_id, roster_slot, acquired_at')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .or(`acquired_at.is.null,acquired_at.lte.${date}T23:59:59.999Z`),
  ]);

  const slotMap = new Map<string, string>();

  // Most recent daily_lineups entry per player (entries are sorted desc by date)
  // This also picks up dropped players who have snapshots
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
