import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function usePlayerSeasonStats(excludePlayerIds?: string[]) {
  return useQuery<PlayerSeasonStats[]>({
    queryKey: queryKeys.playerSeasonStats(excludePlayerIds ?? []),
    queryFn: async () => {
      let query = supabase
        .from('player_season_stats')
        .select('*')
        .gt('games_played', 0)
        .order('avg_pts', { ascending: false })
        .limit(600);

      if (excludePlayerIds && excludePlayerIds.length > 0) {
        query = query.filter(
          'player_id',
          'not.in',
          `(${excludePlayerIds.join(',')})`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    staleTime: 1000 * 60 * 5,
  });
}
