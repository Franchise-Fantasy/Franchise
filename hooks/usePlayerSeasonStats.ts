import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';

export function usePlayerSeasonStats(excludePlayerIds?: string[]) {
  const sport = useActiveLeagueSport();

  return useQuery<PlayerSeasonStats[]>({
    queryKey: [...queryKeys.playerSeasonStats(excludePlayerIds ?? []), sport],
    queryFn: async () => {
      // `pro_team IS NOT NULL` = currently on a real team — works year-round.
      // (Filtering by games_played would hide everyone during the offseason.)
      let query = supabase
        .from('player_season_stats')
        .select('*')
        .eq('sport', sport)
        .not('pro_team', 'is', null)
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
