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
    staleTime: 1000 * 60 * 5,
  });
}

// Returns sets of player_ids and draft_pick_ids that are locked in active trade proposals for a given team
export function useLockedTradeAssets(teamId: string | null, leagueId: string | null) {
  return useQuery({
    queryKey: ['lockedTradeAssets', teamId, leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_proposal_items')
        .select('player_id, draft_pick_id, proposal_id, trade_proposals!inner(status)')
        .eq('from_team_id', teamId!)
        .in('trade_proposals.status', ['pending', 'accepted', 'in_review', 'delayed']);
      if (error) throw error;

      const lockedPlayerIds = new Set<string>();
      const lockedPickIds = new Set<string>();
      for (const item of data ?? []) {
        if (item.player_id) lockedPlayerIds.add(item.player_id);
        if (item.draft_pick_id) lockedPickIds.add(item.draft_pick_id);
      }
      return { lockedPlayerIds, lockedPickIds };
    },
    enabled: !!teamId && !!leagueId,
    staleTime: 1000 * 60 * 2,
  });
}
