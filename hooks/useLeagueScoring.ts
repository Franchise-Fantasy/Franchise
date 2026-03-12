import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function useLeagueScoring(leagueId: string) {
  return useQuery<ScoringWeight[]>({
    queryKey: ['leagueScoring', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_scoring_settings')
        .select('stat_name, point_value, is_enabled, inverse')
        .eq('league_id', leagueId);

      if (error) throw error;

      // Only return enabled stats so disabled settings are never counted
      return (data ?? [])
        .filter((row: any) => row.is_enabled)
        .map((row: any) => ({ stat_name: row.stat_name, point_value: row.point_value, inverse: row.inverse ?? false }));
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
}
