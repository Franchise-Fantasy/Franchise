import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export type GameTimeMap = Map<string, string>;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
