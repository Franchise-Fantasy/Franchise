import { useAppState } from '@/context/AppStateProvider';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export function useLeague() {
  const { leagueId } = useAppState();

  return useQuery({
    queryKey: queryKeys.league(leagueId!),
    queryFn: async () => {
      if (!leagueId) return null;

      const { data, error } = await supabase
        .from('leagues')
        .select(`
          *,
          league_teams:teams!teams_league_id_fkey (
            id,
            name,
            tricode,
            is_commissioner,
            logo_key,
            division,
            user_id
          )
        `)
        .eq('id', leagueId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
    retry: 3,
    retryDelay: 1000,
    staleTime: 1000 * 60, // 1 minute — keep short for phase transitions
  });
}