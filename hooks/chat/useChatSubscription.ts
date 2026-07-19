import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { prependIncomingMessage } from '@/hooks/chat/useMessages';
import { supabase, uniqueChannelTopic } from '@/lib/supabase';

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
      .channel(uniqueChannelTopic(`chat_sub_${conversationId}`))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          // Prepend the enriched row(s) instead of refetching a whole page
          // per incoming message; falls back to invalidate on ambiguity.
          // Own messages included: the same account on another device needs
          // the echo, and the prepend dedupes this device's optimistic row.
          void prependIncomingMessage(queryClient, conversationId!);
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
