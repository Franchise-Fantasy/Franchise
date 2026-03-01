import { supabase } from '@/lib/supabase';

/** Fetch NBA games for a date and return a map of tricode → matchup string (e.g. "vs MIA", "@BOS"). */
export async function fetchNbaScheduleForDate(date: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('nba_schedule')
    .select('home_team, away_team')
    .eq('game_date', date);
  const map = new Map<string, string>();
  for (const game of data ?? []) {
    map.set(game.home_team, `vs ${game.away_team}`);
    map.set(game.away_team, `@${game.home_team}`);
  }
  return map;
}
