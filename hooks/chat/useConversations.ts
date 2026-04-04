import { useAppState } from '@/context/AppStateProvider';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { ConversationPreview } from '@/types/chat';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

// ─── Shared realtime subscription for chat_messages ─────────
// Both useConversations and useTotalUnread need to know about new
// messages in the league. One channel serves both, halving the
// realtime connection cost.

function useChatMessageSubscription(leagueId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`chat_messages_${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId!) });
          queryClient.invalidateQueries({ queryKey: queryKeys.chatUnread(leagueId!) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);
}

// ─── Conversation list ───────────────────────────────────────

export function useConversations() {
  const { leagueId, teamId } = useAppState();

  useChatMessageSubscription(leagueId);

  return useQuery<ConversationPreview[]>({
    queryKey: queryKeys.conversations(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_conversations', {
        p_league_id: leagueId!,
        p_team_id: teamId!,
      });
      if (error) throw error;
      return (data ?? []) as ConversationPreview[];
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 30_000,
  });
}

// ─── Unread badge count ──────────────────────────────────────

export function useTotalUnread() {
  const { leagueId, teamId } = useAppState();

  useChatMessageSubscription(leagueId);

  return useQuery<number>({
    queryKey: queryKeys.chatUnread(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_total_unread', {
        p_league_id: leagueId!,
        p_team_id: teamId!,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 30_000,
  });
}
