import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function usePlayerGameLog(playerId: string) {
  return useQuery<PlayerGameLog[]>({
    queryKey: ['playerGameLog', playerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_games')
        .select('*')
        .eq('player_id', playerId)
        .order('game_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as PlayerGameLog[];
    },
    enabled: !!playerId,
    staleTime: 1000 * 60 * 5,
  });
}
