import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';

export function useTeamRosterStats(leagueId: string, teamId: string) {
  return useQuery<PlayerSeasonStats[]>({
    queryKey: queryKeys.teamRosterStats(leagueId, teamId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_team_roster_stats' as any, {
        p_league_id: leagueId,
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as PlayerSeasonStats[];
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 1000 * 60 * 10,
  });
}
