import { supabase } from '@/lib/supabase';
import type { ReactionGroup } from '@/types/chat';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

// ─── Reactions ───────────────────────────────────────────────
// Realtime subscription is handled by useChatSubscription (one channel
// for both messages + reactions), called from the chat screen.

export function useReactions(
  conversationId: string | null,
  messageIds: string[],
  myTeamId: string | null,
) {
  return useQuery<Record<string, ReactionGroup[]>>({
    queryKey: ['reactions', conversationId, messageIds],
    queryFn: async () => {
      if (messageIds.length === 0) return {};
      const { data, error } = await supabase
        .from('chat_reactions')
        .select('id, message_id, team_id, emoji, teams(name)')
        .in('message_id', messageIds);
      if (error) throw error;

      const grouped: Record<string, ReactionGroup[]> = {};
      for (const r of data ?? []) {
        if (!grouped[r.message_id]) grouped[r.message_id] = [];
        const groups = grouped[r.message_id];
        const existing = groups.find((g) => g.emoji === r.emoji);
        const tName = (r as any).teams?.name ?? 'Unknown';
        const isMine = r.team_id === myTeamId;
        if (existing) {
          existing.count++;
          existing.team_names.push(tName);
          if (isMine) existing.reacted_by_me = true;
        } else {
          groups.push({
            emoji: r.emoji,
            count: 1,
            reacted_by_me: isMine,
            team_names: [tName],
          });
        }
      }
      return grouped;
    },
    enabled: !!conversationId && messageIds.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useToggleReaction(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      teamId,
      emoji,
    }: {
      messageId: string;
      teamId: string;
      emoji: string;
    }) => {
      const { data: existing } = await supabase
        .from('chat_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('team_id', teamId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (existing) {
        await supabase.from('chat_reactions').delete().eq('id', existing.id);
      } else {
        await supabase
          .from('chat_reactions')
          .insert({ message_id: messageId, team_id: teamId, emoji, conversation_id: conversationId });
      }
    },
    onMutate: async ({ messageId, teamId, emoji }) => {
      await queryClient.cancelQueries({
        queryKey: ['reactions', conversationId],
        exact: false,
      });

      // Snapshot all reaction queries for this conversation
      const cache = queryClient.getQueriesData<Record<string, ReactionGroup[]>>({
        queryKey: ['reactions', conversationId],
      });

      // Optimistically toggle the reaction in every matching cache entry
      for (const [key] of cache) {
        queryClient.setQueryData<Record<string, ReactionGroup[]>>(key, (old) => {
          if (!old) return old;
          const groups = [...(old[messageId] ?? [])];
          const idx = groups.findIndex((g) => g.emoji === emoji);

          if (idx >= 0 && groups[idx].reacted_by_me) {
            // Remove our reaction
            if (groups[idx].count <= 1) {
              groups.splice(idx, 1);
            } else {
              groups[idx] = { ...groups[idx], count: groups[idx].count - 1, reacted_by_me: false };
            }
          } else if (idx >= 0) {
            // Add our reaction to existing group
            groups[idx] = { ...groups[idx], count: groups[idx].count + 1, reacted_by_me: true };
          } else {
            // New emoji group
            groups.push({ emoji, count: 1, reacted_by_me: true, team_names: [] });
          }

          return { ...old, [messageId]: groups };
        });
      }

      return { cache };
    },
    onError: (_err, _vars, context) => {
      // Rollback to previous cache state
      if (context?.cache) {
        for (const [key, data] of context.cache) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['reactions', conversationId],
      });
    },
  });
}
