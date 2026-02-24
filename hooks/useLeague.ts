import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export function useLeague() {
  const { leagueId } = useAppState();

  return useQuery({
    queryKey: ['league', leagueId],
    queryFn: async () => {
      console.log('[useLeague] Fetching league:', leagueId);

      if (!leagueId) {
        console.log('[useLeague] No leagueId provided');
        return null;
      }

      const { data, error } = await supabase
        .from('leagues')
        .select(`
          *,
          league_teams:teams!teams_league_id_fkey (
            id,
            name,
            is_commissioner
          )
        `)
        .eq('id', leagueId)
        .single();

      if (error) {
        console.error('[useLeague] Error:', error);
        throw error;
      }

      console.log('[useLeague] Fetched data:', data);
      return data;
    },
    enabled: !!leagueId,
    retry: 3,
    retryDelay: 1000,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}