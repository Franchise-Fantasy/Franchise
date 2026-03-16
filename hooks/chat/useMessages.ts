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

interface Cursor {
  cursor: string | null;
  cursorId: string | null;
}

// ─── Messages (infinite scroll, cursor-based) ───────────────

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
    queryFn: async ({ pageParam }: { pageParam: Cursor }) => {
      const { data, error } = await supabase.rpc('get_messages_page', {
        p_conversation_id: conversationId!,
        p_cursor: pageParam.cursor,
        p_cursor_id: pageParam.cursorId,
        p_limit: PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
    initialPageParam: { cursor: null, cursorId: null } as Cursor,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      // Find the last real message (skip optimistic temp- messages)
      const last = [...lastPage].reverse().find((m) => !m.id.startsWith('temp-'));
      if (!last) return undefined;
      return { cursor: last.created_at, cursorId: last.id } as Cursor;
    },
    enabled: !!conversationId,
  });
}

// ─── Send message ────────────────────────────────────────────

export function useSendMessage(
  conversationId: string,
  teamId: string,
  teamName: string,
  leagueId: string,
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
          league_id: leagueId,
        })
        .select()
        .single();
      if (error) throw error;

      // Fire-and-forget push notification to other members
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
          if (!old) return { pages: [[optimistic]], pageParams: [{ cursor: null, cursorId: null }] };
          const pages = [...old.pages];
          pages[0] = [optimistic, ...pages[0]];
          return { ...old, pages };
        },
      );
      return { previous };
    },
    onError: (err, _content, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['messages', conversationId],
          context.previous,
        );
      }
      console.error('Send message error:', err);
      globalToastRef.current?.('error', `Message failed to send: ${(err as any)?.message ?? err}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
      });
      queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['chatUnread', leagueId] });
    },
  });
}
