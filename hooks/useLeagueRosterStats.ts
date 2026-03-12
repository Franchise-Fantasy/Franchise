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
      // Get all rostered players with their team assignments
      const { data: roster, error: rosterErr } = await supabase
        .from('league_players')
        .select('player_id, team_id')
        .eq('league_id', leagueId)
        .not('team_id', 'is', null);

      if (rosterErr) throw rosterErr;
      if (!roster?.length) return [];

      const playerIds = roster.map((r) => r.player_id);
      const teamMap = new Map(roster.map((r) => [r.player_id, r.team_id]));

      const { data: stats, error: statsErr } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsErr) throw statsErr;

      return (stats ?? []).map((p) => ({
        ...(p as PlayerSeasonStats),
        team_id: teamMap.get(p.player_id)!,
      }));
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
