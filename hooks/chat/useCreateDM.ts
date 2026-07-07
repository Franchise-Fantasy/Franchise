import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

// ─── Create DM ───────────────────────────────────────────────

export function useCreateDM(leagueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      myTeamId,
      otherTeamId,
    }: {
      myTeamId: string;
      otherTeamId: string;
    }) => {
      // Find-or-create runs server-side (SECURITY DEFINER) so the DM's two
      // memberships are written atomically under an ownership check. Direct
      // chat_members inserts are no longer permitted from the client (a member
      // could otherwise add themselves to any conversation in the league).
      const { data: conversationId, error } = await supabase.rpc(
        'get_or_create_dm',
        {
          p_league_id: leagueId,
          p_my_team_id: myTeamId,
          p_other_team_id: otherTeamId,
        },
      );
      if (error) throw error;
      return conversationId as string;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
    },
  });
}
