import type { Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';

export type ScheduleEntry = {
  matchup: string;
  gameTimeUtc: string | null;
  /** Final score oriented from this team's perspective ("82-80"), or null until
   *  the game finalizes. Persisted in game_schedule by sync-game-schedule, so
   *  past-day cells can show the real score after live stats have expired. */
  score: string | null;
};

/** Fetch games for a date (scoped by sport) and return tricode → schedule entry. */
export async function fetchNbaScheduleForDate(
  date: string,
  sport: Sport = 'nba',
): Promise<Map<string, ScheduleEntry>> {
  const { data } = await supabase
    .from('game_schedule')
    .select('home_team, away_team, game_time_utc, home_score, away_score, status')
    .eq('sport', sport)
    .eq('game_date', date);
  const map = new Map<string, ScheduleEntry>();
  for (const game of data ?? []) {
    const isFinal =
      game.status === 'final' && game.home_score != null && game.away_score != null;
    map.set(game.home_team, {
      matchup: `vs ${game.away_team}`,
      gameTimeUtc: game.game_time_utc,
      score: isFinal ? `${game.home_score}-${game.away_score}` : null,
    });
    map.set(game.away_team, {
      matchup: `@${game.home_team}`,
      gameTimeUtc: game.game_time_utc,
      score: isFinal ? `${game.away_score}-${game.home_score}` : null,
    });
  }
  return map;
}

/** Format a UTC ISO timestamp to compact local time, e.g. "7:30p" / "1:00p" */
export function formatGameTime(utcIso: string): string {
  const d = new Date(utcIso);
  let hours = d.getHours();
  const mins = d.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  hours = hours % 12 || 12;
  return `${hours}:${mins.toString().padStart(2, '0')}${ampm}`;
}
