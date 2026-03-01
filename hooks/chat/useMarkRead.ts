import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

// ─── Mark read ───────────────────────────────────────────────

export function useMarkRead(
  conversationId: string | null,
  teamId: string | null,
) {
  const queryClient = useQueryClient();
  const { leagueId } = useAppState();

  useEffect(() => {
    if (!conversationId || !teamId) return;
    supabase
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('team_id', teamId)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
        queryClient.invalidateQueries({ queryKey: ['chatUnread', leagueId] });
      });
  }, [conversationId, teamId, leagueId, queryClient]);
}
