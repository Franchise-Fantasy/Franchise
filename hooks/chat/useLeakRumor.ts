import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const RUMOR_TEMPLATES = [
  'League sources report discussions involving {player} are heating up',
  'Sources: {player} could be on the move soon',
  'Word around the league is that {player} is drawing significant interest',
  'A rival executive believes {player} is available for the right price',
] as const;

export { RUMOR_TEMPLATES };

/** Walk up counteroffer_of chain to find the root proposal ID */
async function findChainRoot(proposalId: string): Promise<string> {
  let currentId = proposalId;
  for (let i = 0; i < 20; i++) {
    const { data } = await supabase
      .from('trade_proposals')
      .select('counteroffer_of')
      .eq('id', currentId)
      .single();
    if (!data?.counteroffer_of) return currentId;
    currentId = data.counteroffer_of;
  }
  return currentId;
}

/** Check if a manual leak already exists for this proposal chain */
export function useCanLeak(proposalId: string | null, leagueId: string | null) {
  return useQuery({
    queryKey: ['canLeak', proposalId],
    queryFn: async () => {
      if (!proposalId) return false;
      const rootId = await findChainRoot(proposalId);

      const { count } = await supabase
        .from('trade_rumors')
        .select('id', { count: 'exact', head: true })
        .eq('proposal_id', rootId)
        .eq('trigger_type', 'manual');

      return (count ?? 0) === 0;
    },
    enabled: !!proposalId && !!leagueId,
  });
}

interface LeakParams {
  proposalId: string;
  leagueId: string;
  teamId: string;
  playerId: string;
  playerName: string;
  template: string;
}

export function useLeakRumor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ proposalId, leagueId, teamId, playerId, playerName, template }: LeakParams) => {
      const { error } = await supabase.rpc('leak_trade_rumor', {
        p_league_id: leagueId,
        p_team_id: teamId,
        p_player_id: playerId,
        p_proposal_id: proposalId,
        p_template: template,
        p_player_name: playerName,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['canLeak', vars.proposalId] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', vars.leagueId] });

      // Push notify the league about the leaked rumor
      sendNotification({
        league_id: vars.leagueId,
        category: 'trade_rumors',
        title: 'Trade Rumor',
        body: vars.template.replace('{player}', vars.playerName),
        data: { screen: 'chat' },
      });
    },
  });
}
