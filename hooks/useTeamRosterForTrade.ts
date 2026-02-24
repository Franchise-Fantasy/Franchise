import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export function useTeamRosterForTrade(teamId: string | null, leagueId: string | null) {
  return useQuery<PlayerSeasonStats[]>({
    queryKey: ['teamRosterForTrade', teamId, leagueId],
    queryFn: async () => {
      // Get player IDs on this team
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('team_id', teamId!)
        .eq('league_id', leagueId!);
      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map((lp) => lp.player_id);

      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);
      if (error) throw error;
      return (data ?? []) as PlayerSeasonStats[];
    },
    enabled: !!teamId && !!leagueId,
  });
}
