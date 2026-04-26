import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { ChatMessage } from '@/types/chat';

// ─── Fetch pinned messages for a conversation ────────────────

export function usePinnedMessages(conversationId: string | null) {
  const queryClient = useQueryClient();

  // Realtime: refresh when pins change
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat_pins_${conversationId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_pins',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.pinnedMessages(conversationId!) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // queryClient is a stable singleton — omitting prevents unnecessary channel teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return useQuery<ChatMessage[]>({
    queryKey: queryKeys.pinnedMessages(conversationId!),
    queryFn: async () => {
      const { data: pins, error: pinError } = await supabase
        .from('chat_pins')
        .select('message_id')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false });

      if (pinError) throw pinError;
      if (!pins || pins.length === 0) return [];

      const messageIds = pins.map((p) => p.message_id);
      const { data: messages, error: msgError } = await supabase
        .from('chat_messages')
        .select('id, conversation_id, team_id, content, type, created_at, teams(name)')
        .in('id', messageIds);

      if (msgError) throw msgError;

      const rawMessages = messages ?? [];

      // Look up poll/survey titles up-front so we can fold them into the mapped
      // result rather than mutating it after construction.
      const pollIds = rawMessages.filter((m) => m.type === 'poll').map((m) => m.content);
      const surveyIds = rawMessages.filter((m) => m.type === 'survey').map((m) => m.content);

      const pollMap = new Map<string, string>();
      if (pollIds.length > 0) {
        const { data: polls } = await supabase
          .from('commissioner_polls')
          .select('id, question')
          .in('id', pollIds);
        for (const p of polls ?? []) pollMap.set(p.id, p.question);
      }

      const surveyMap = new Map<string, string>();
      if (surveyIds.length > 0) {
        const { data: surveys } = await supabase
          .from('commissioner_surveys')
          .select('id, title')
          .in('id', surveyIds);
        for (const s of surveys ?? []) surveyMap.set(s.id, s.title);
      }

      return rawMessages.map((m) => {
        const teams = Array.isArray(m.teams) ? m.teams[0] ?? null : m.teams;
        return {
          ...m,
          team_name: teams?.name ?? undefined,
          teams: undefined,
          poll_question: m.type === 'poll' ? pollMap.get(m.content) ?? null : null,
          survey_title: m.type === 'survey' ? surveyMap.get(m.content) ?? null : null,
        };
      }) as ChatMessage[];
    },
    enabled: !!conversationId,
    staleTime: 60_000,
  });
}

// ─── Check if a specific message is pinned ──────────────────

export function useIsMessagePinned(conversationId: string | null, messageId: string | null) {
  const { data: pinnedMessages } = usePinnedMessages(conversationId);
  return pinnedMessages?.some((m) => m.id === messageId) ?? false;
}

// ─── Toggle pin/unpin a message ─────────────────────────────

export function useTogglePin(conversationId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, teamId, isPinned }: { messageId: string; teamId: string; isPinned: boolean }) => {
      if (isPinned) {
        const { error } = await supabase
          .from('chat_pins')
          .delete()
          .eq('message_id', messageId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('chat_pins')
          .insert({
            message_id: messageId,
            conversation_id: conversationId!,
            pinned_by: teamId,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pinnedMessages(conversationId!) });
    },
  });
}
