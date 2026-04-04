import { queryKeys } from '@/constants/queryKeys';
import { globalToastRef } from '@/context/ToastProvider';
import { sendNotification } from '@/lib/notifications';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ChatMessageType } from '@/types/chat';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

const PAGE_SIZE = 30;

interface Cursor {
  cursor: string | null;
  cursorId: string | null;
}

// ─── Messages (infinite scroll, cursor-based) ───────────────
// Realtime subscription is handled by useChatSubscription (one channel
// for both messages + reactions), called from the chat screen.

export function useMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(conversationId!),
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
    maxPages: 10, // Cap at ~300 messages in memory; older pages re-fetch on scroll
  });
}

// ─── Send message ────────────────────────────────────────────

// ─── Unsend (delete) message ────────────────────────────────

export function useUnsendMessage(conversationId: string, leagueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('id', messageId);
      if (error) throw error;
    },
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.messages(conversationId),
      });
      const previous = queryClient.getQueryData(queryKeys.messages(conversationId));

      queryClient.setQueryData(
        queryKeys.messages(conversationId),
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page: ChatMessage[]) =>
              page.filter((m) => m.id !== messageId),
            ),
          };
        },
      );
      return { previous };
    },
    onError: (err, _messageId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.messages(conversationId),
          context.previous,
        );
      }
      console.error('Unsend message error:', err);
      globalToastRef.current?.('error', 'Failed to unsend message');
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages(conversationId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId) });
    },
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
    mutationFn: async ({
      content,
      type = 'text',
    }: {
      content: string;
      type?: ChatMessageType;
    }) => {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          team_id: teamId,
          content,
          type,
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
            type === 'image'
              ? '\ud83d\udcf7 Photo'
              : type === 'gif'
                ? 'GIF'
                : content.length > 100
                  ? content.slice(0, 100) + '\u2026'
                  : content;
          sendNotification({
            league_id: leagueId,
            team_ids: otherTeamIds,
            category: 'chat',
            title: teamName,
            body: preview,
            data: { screen: `chat/${conversationId}` },
          });
        })
        .catch((err: any) => console.warn('Chat push notification failed:', err?.message ?? err));

      return data;
    },
    onMutate: async ({ content, type = 'text' }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.messages(conversationId),
      });
      const previous = queryClient.getQueryData(queryKeys.messages(conversationId));

      const optimistic: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversation_id: conversationId,
        team_id: teamId,
        team_name: teamName,
        content,
        type,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData(
        queryKeys.messages(conversationId),
        (old: any) => {
          if (!old) return { pages: [[optimistic]], pageParams: [{ cursor: null, cursorId: null }] };
          const pages = [...old.pages];
          pages[0] = [optimistic, ...pages[0]];
          return { ...old, pages };
        },
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.messages(conversationId),
          context.previous,
        );
      }
      console.error('Send message error:', err);
      globalToastRef.current?.('error', `Message failed to send: ${(err as any)?.message ?? err}`);
    },
    onSuccess: (_data, { type = 'text' }) => {
      capture('chat_message_sent', { type });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages(conversationId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chatUnread(leagueId) });
    },
  });
}
