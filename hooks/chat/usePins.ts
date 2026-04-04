import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { ChatMessage } from '@/types/chat';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

// ─── Fetch pinned messages for a conversation ────────────────

export function usePinnedMessages(conversationId: string | null) {
  const queryClient = useQueryClient();

  // Realtime: refresh when pins change
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat_pins_${conversationId}`)
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
  }, [conversationId, queryClient]);

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

      const mapped = (messages ?? []).map((m: any) => ({
        ...m,
        team_name: m.teams?.name ?? undefined,
        teams: undefined,
      }));

      // Enrich poll/survey messages with their titles
      const pollMsgs = mapped.filter((m) => m.type === 'poll');
      const surveyMsgs = mapped.filter((m) => m.type === 'survey');

      if (pollMsgs.length > 0) {
        const pollIds = pollMsgs.map((m) => m.content);
        const { data: polls } = await supabase
          .from('commissioner_polls')
          .select('id, question')
          .in('id', pollIds);
        const pollMap = new Map((polls ?? []).map((p: any) => [p.id, p.question]));
        for (const m of pollMsgs) {
          (m as any).poll_question = pollMap.get(m.content) ?? null;
        }
      }

      if (surveyMsgs.length > 0) {
        const surveyIds = surveyMsgs.map((m) => m.content);
        const { data: surveys } = await supabase
          .from('commissioner_surveys')
          .select('id, title')
          .in('id', surveyIds);
        const surveyMap = new Map((surveys ?? []).map((s: any) => [s.id, s.title]));
        for (const m of surveyMsgs) {
          (m as any).survey_title = surveyMap.get(m.content) ?? null;
        }
      }

      return mapped;
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
