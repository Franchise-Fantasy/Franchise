import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';
import { useQuery } from '@tanstack/react-query';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';

// Per-sport game-log cap. Future sports default to a generous limit until
// wired up.
const GAME_LIMIT_BY_SPORT: Record<string, number> = {
  nba: 82, wnba: 40, nfl: 18, nhl: 82, mlb: 162,
};

export function usePlayerGameLog(playerId: string) {
  const sport = useActiveLeagueSport();
  const limit = GAME_LIMIT_BY_SPORT[sport] ?? 82;

  return useQuery<PlayerGameLog[]>({
    queryKey: [...queryKeys.playerGameLog(playerId), sport],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_games')
        .select('*')
        .eq('sport', sport)
        .eq('player_id', playerId)
        .order('game_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      const rows = data as PlayerGameLog[];

      // Deduplicate: if a player has multiple entries on the same date
      // (ghost rows from backfill after a trade), keep the one with more minutes
      const seen = new Map<string, PlayerGameLog>();
      for (const row of rows) {
        if (!row.game_date) continue;
        const existing = seen.get(row.game_date);
        if (!existing || row.min > existing.min) {
          seen.set(row.game_date, row);
        }
      }
      return Array.from(seen.values());
    },
    enabled: !!playerId,
    staleTime: 1000 * 60 * 5,
  });
}
