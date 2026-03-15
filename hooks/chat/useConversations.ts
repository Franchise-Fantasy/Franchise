import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import type { ConversationPreview } from '@/types/chat';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

// ─── Conversation list ───────────────────────────────────────

export function useConversations() {
  const { leagueId, teamId } = useAppState();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`chat_list_${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);

  return useQuery<ConversationPreview[]>({
    queryKey: ['conversations', leagueId],
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
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`chat_unread_${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['chatUnread', leagueId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);

  return useQuery<number>({
    queryKey: ['chatUnread', leagueId],
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
