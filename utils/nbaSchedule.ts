import { supabase } from '@/lib/supabase';
import type { Sport } from '@/constants/LeagueDefaults';

export type ScheduleEntry = { matchup: string; gameTimeUtc: string | null };

/** Fetch games for a date (scoped by sport) and return tricode → schedule entry. */
export async function fetchNbaScheduleForDate(
  date: string,
  sport: Sport = 'nba',
): Promise<Map<string, ScheduleEntry>> {
  const { data } = await supabase
    .from('game_schedule')
    .select('home_team, away_team, game_time_utc')
    .eq('sport', sport)
    .eq('game_date', date);
  const map = new Map<string, ScheduleEntry>();
  for (const game of data ?? []) {
    map.set(game.home_team, { matchup: `vs ${game.away_team}`, gameTimeUtc: game.game_time_utc });
    map.set(game.away_team, { matchup: `@${game.home_team}`, gameTimeUtc: game.game_time_utc });
  }
  return map;
}

/** Format a UTC ISO timestamp to compact local time, e.g. "7:30p" */
export function formatGameTime(utcIso: string): string {
  const d = new Date(utcIso);
  let hours = d.getHours();
  const mins = d.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  hours = hours % 12 || 12;
  const minStr = mins === 0 ? '' : `:${mins.toString().padStart(2, '0')}`;
  return `${hours}${minStr}${ampm}`;
}
