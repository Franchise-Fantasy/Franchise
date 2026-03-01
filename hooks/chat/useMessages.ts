import { globalToastRef } from '@/context/ToastProvider';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import type { ChatMessage } from '@/types/chat';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

const PAGE_SIZE = 30;

// ─── Messages (infinite scroll) ─────────────────────────────

export function useMessages(conversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat_msgs_${conversationId}_${Date.now()}`)
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
            queryKey: ['messages', conversationId],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, conversation_id, team_id, content, type, created_at, teams(name)')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        team_id: m.team_id,
        content: m.content,
        type: m.type ?? 'text',
        created_at: m.created_at,
        team_name: m.teams?.name ?? 'Unknown',
      })) as ChatMessage[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!conversationId,
  });
}

// ─── Send message ────────────────────────────────────────────

export function useSendMessage(
  conversationId: string,
  teamId: string,
  teamName: string,
  leagueId?: string | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          team_id: teamId,
          content,
        })
        .select()
        .single();
      if (error) throw error;

      // Fire-and-forget push notification to other members
      if (leagueId) {
        supabase
          .from('chat_members')
          .select('team_id')
          .eq('conversation_id', conversationId)
          .neq('team_id', teamId)
          .then(({ data: members }) => {
            if (!members || members.length === 0) return;
            const otherTeamIds = members.map((m) => m.team_id);
            const preview =
              content.length > 100 ? content.slice(0, 100) + '\u2026' : content;
            sendNotification({
              league_id: leagueId,
              team_ids: otherTeamIds,
              category: 'chat',
              title: teamName,
              body: preview,
              data: { screen: `chat/${conversationId}` },
            });
          });
      }

      return data;
    },
    onMutate: async (content) => {
      await queryClient.cancelQueries({
        queryKey: ['messages', conversationId],
      });
      const previous = queryClient.getQueryData(['messages', conversationId]);

      const optimistic: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversation_id: conversationId,
        team_id: teamId,
        team_name: teamName,
        content,
        type: 'text',
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData(
        ['messages', conversationId],
        (old: any) => {
          if (!old) return { pages: [[optimistic]], pageParams: [0] };
          const pages = [...old.pages];
          pages[0] = [optimistic, ...pages[0]];
          return { ...old, pages };
        },
      );
      return { previous };
    },
    onError: (_err, _content, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['messages', conversationId],
          context.previous,
        );
      }
      globalToastRef.current?.('error', 'Message failed to send');
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
      });
      if (leagueId) {
        queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
        queryClient.invalidateQueries({ queryKey: ['chatUnread', leagueId] });
      }
    },
  });
}
