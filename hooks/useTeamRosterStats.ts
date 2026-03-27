import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function useTeamRosterStats(leagueId: string, teamId: string) {
  return useQuery<PlayerSeasonStats[]>({
    queryKey: ['teamRosterStats', leagueId, teamId],
    queryFn: async () => {
      const rosterRes = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId);

      if (rosterRes.error) throw rosterRes.error;
      if (!rosterRes.data?.length) return [];

      const playerIds = rosterRes.data.map((r) => r.player_id);
      const statsRes = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsRes.error) throw statsRes.error;
      return (statsRes.data as PlayerSeasonStats[]) ?? [];
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 1000 * 60 * 10,
  });
}
