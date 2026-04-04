import { useAppState } from '@/context/AppStateProvider';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

// ─── Mark read ───────────────────────────────────────────────

export function useMarkRead(
  conversationId: string | null,
  teamId: string | null,
  newestMessageId: string | null,
  /** Callback to broadcast updated read position via presence */
  onReadUpdate?: ((messageId: string) => void) | null,
) {
  const queryClient = useQueryClient();
  const { leagueId } = useAppState();
  const lastMarkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId || !teamId || !newestMessageId) return;
    if (newestMessageId.startsWith('temp-')) return;
    // Don't re-mark the same message
    if (lastMarkedRef.current === newestMessageId) return;
    lastMarkedRef.current = newestMessageId;

    // Persist to DB
    supabase
      .from('chat_members')
      .update({
        last_read_at: new Date().toISOString(),
        last_read_message_id: newestMessageId,
      })
      .eq('conversation_id', conversationId)
      .eq('team_id', teamId)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId!) });
        queryClient.invalidateQueries({ queryKey: queryKeys.chatUnread(leagueId!) });
      })
      .catch((err: any) => console.warn('useMarkRead update failed:', err?.message ?? err));

    // Broadcast via presence channel for instant updates
    onReadUpdate?.(newestMessageId);
  }, [conversationId, teamId, newestMessageId, leagueId, queryClient, onReadUpdate]);
}
