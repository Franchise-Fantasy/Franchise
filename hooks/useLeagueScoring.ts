import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function useLeagueScoring(leagueId: string) {
  return useQuery<ScoringWeight[]>({
    queryKey: ['leagueScoring', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_scoring_settings')
        .select('stat_name, point_value')
        .eq('league_id', leagueId);

      if (error) throw error;
      return data as ScoringWeight[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
}
