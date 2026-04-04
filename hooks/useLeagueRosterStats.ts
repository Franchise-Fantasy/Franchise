import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export interface LeaguePlayerWithTeam extends PlayerSeasonStats {
  team_id: string;
}

export function useLeagueRosterStats(leagueId: string) {
  return useQuery<LeaguePlayerWithTeam[]>({
    queryKey: queryKeys.leagueRosterStats(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_league_roster_stats' as any, {
        p_league_id: leagueId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as LeaguePlayerWithTeam[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
