import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function useTeamRosterStats(leagueId: string, teamId: string) {
  return useQuery<PlayerSeasonStats[]>({
    queryKey: ['teamRosterStats', leagueId, teamId],
    queryFn: async () => {
      // Get player IDs on this team
      const { data: roster, error: rosterErr } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId);

      if (rosterErr) throw rosterErr;
      if (!roster?.length) return [];

      const playerIds = roster.map((r) => r.player_id);

      const { data: stats, error: statsErr } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsErr) throw statsErr;
      return (stats as PlayerSeasonStats[]) ?? [];
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 1000 * 60 * 10,
  });
}
