import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Single realtime channel per conversation that handles both message INSERTs
 * and reaction changes. Replaces the two separate channels that useMessages
 * and useReactions previously opened, cutting per-conversation connections
 * from 3 (messages + reactions + presence) to 2.
 */
export function useChatSubscription(conversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat_sub_${conversationId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.messages(conversationId!),
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.reactions(conversationId!),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // queryClient is a stable singleton — omitting it prevents unnecessary channel teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
}
