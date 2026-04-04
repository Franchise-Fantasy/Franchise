import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function usePlayerGameLog(playerId: string) {
  return useQuery<PlayerGameLog[]>({
    queryKey: queryKeys.playerGameLog(playerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_games')
        .select('*')
        .eq('player_id', playerId)
        .order('game_date', { ascending: false })
        .limit(82);

      if (error) throw error;
      const rows = data as PlayerGameLog[];

      // Deduplicate: if a player has multiple entries on the same date
      // (ghost rows from backfill after a trade), keep the one with more minutes
      const seen = new Map<string, PlayerGameLog>();
      for (const row of rows) {
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
