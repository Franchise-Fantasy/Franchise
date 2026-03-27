import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';

export interface LeaguePlayerWithTeam extends PlayerSeasonStats {
  team_id: string;
}

export function useLeagueRosterStats(leagueId: string) {
  return useQuery<LeaguePlayerWithTeam[]>({
    queryKey: ['leagueRosterStats', leagueId],
    queryFn: async () => {
      const rosterRes = await supabase
        .from('league_players')
        .select('player_id, team_id')
        .eq('league_id', leagueId)
        .not('team_id', 'is', null);

      if (rosterRes.error) throw rosterRes.error;
      if (!rosterRes.data?.length) return [];

      const teamMap = new Map(rosterRes.data.map((r) => [r.player_id, r.team_id]));
      const playerIds = rosterRes.data.map((r) => r.player_id);

      const statsRes = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsRes.error) throw statsRes.error;

      return ((statsRes.data ?? []) as PlayerSeasonStats[])
        .filter((s) => teamMap.has(s.player_id))
        .map((s) => ({
          ...s,
          team_id: teamMap.get(s.player_id)!,
        }));
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
