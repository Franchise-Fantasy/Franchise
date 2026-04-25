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
      // Check if DM already exists between these two teams in this league
      const { data: myConvos } = await supabase
        .from('chat_members')
        .select(
          'conversation_id, chat_conversations!inner(id, type, league_id)',
        )
        .eq('team_id', myTeamId)
        .eq('chat_conversations.league_id', leagueId)
        .eq('chat_conversations.type', 'dm');

      if (myConvos && myConvos.length > 0) {
        const dmConvIds = myConvos.map((r) => r.conversation_id);
        // Single query: check if otherTeamId is in any of these DM conversations
        const { data: otherMembers } = await supabase
          .from('chat_members')
          .select('conversation_id')
          .in('conversation_id', dmConvIds)
          .eq('team_id', otherTeamId)
          .limit(1);
        if (otherMembers && otherMembers.length > 0) return otherMembers[0].conversation_id;
      }

      // Create new DM
      const { data: conv, error: convErr } = await supabase
        .from('chat_conversations')
        .insert({ league_id: leagueId, type: 'dm' })
        .select()
        .single();
      if (convErr) throw convErr;

      const { error: memErr } = await supabase.from('chat_members').insert([
        { conversation_id: conv.id, team_id: myTeamId },
        { conversation_id: conv.id, team_id: otherTeamId },
      ]);
      if (memErr) throw memErr;

      return conv.id as string;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
    },
  });
}
