import { supabase } from '@/lib/supabase';
import { toDateStr } from '@/utils/dates';
import { useQuery } from '@tanstack/react-query';

export type GameTimeMap = Map<string, string>;

/**
 * Returns a map of NBA tricode → game_time_utc ISO string for today's games.
 * Enabled only when `enabled` is true (i.e. viewing today's date).
 */
export function useTodayGameTimes(enabled: boolean): GameTimeMap {
  const today = toDateStr(new Date());

  const { data } = useQuery<GameTimeMap>({
    queryKey: ['todayGameTimes', today],
    queryFn: async () => {
      const { data } = await supabase
        .from('nba_schedule')
        .select('home_team, away_team, game_time_utc')
        .eq('game_date', today)
        .not('game_time_utc', 'is', null);
      const map = new Map<string, string>();
      for (const game of data ?? []) {
        map.set(game.home_team, game.game_time_utc);
        map.set(game.away_team, game.game_time_utc);
      }
      return map;
    },
    enabled,
    staleTime: 1000 * 60 * 60,
  });

  return data ?? new Map();
}

/**
 * Returns true if ANY NBA game today has already started (for daily lock mode).
 */
export function hasAnyGameStarted(gameTimeMap: GameTimeMap): boolean {
  const now = new Date();
  for (const timeStr of gameTimeMap.values()) {
    if (new Date(timeStr) <= now) return true;
  }
  return false;
}

/**
 * Returns true if the player's game has started based on schedule time
 * or live game status (backup signal).
 */
export function isGameStarted(
  nbaTricode: string | null,
  gameTimeMap: GameTimeMap,
  liveGameStatus?: number,
): boolean {
  if (liveGameStatus && liveGameStatus >= 2) return true;
  if (!nbaTricode) return false;
  const timeStr = gameTimeMap.get(nbaTricode);
  if (!timeStr) return false;
  return new Date() >= new Date(timeStr);
}
