import { useAppState } from '@/context/AppStateProvider';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ConversationPreview, ReactionGroup } from '@/types/chat';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

const PAGE_SIZE = 30;

// ─── Conversation list ───────────────────────────────────────

export function useConversations() {
  const { leagueId, teamId } = useAppState();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`chat_list_${leagueId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
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
      // Get all conversations I'm a member of in this league
      const { data: memberships, error: memErr } = await supabase
        .from('chat_members')
        .select(
          'conversation_id, last_read_at, team_id, chat_conversations!inner(id, league_id, type, created_at)',
        )
        .eq('team_id', teamId!)
        .eq('chat_conversations.league_id', leagueId!);
      if (memErr) throw memErr;

      const previews: ConversationPreview[] = [];

      for (const mem of memberships ?? []) {
        const conv = (mem as any).chat_conversations;

        // Latest message
        const { data: msgs } = await supabase
          .from('chat_messages')
          .select('content, created_at, team_id, teams(name)')
          .eq('conversation_id', mem.conversation_id)
          .order('created_at', { ascending: false })
          .limit(1);

        const lastMsg = msgs?.[0] ?? null;

        // Unread count (exclude own messages)
        const { count } = await supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', mem.conversation_id)
          .neq('team_id', teamId!)
          .gt('created_at', mem.last_read_at);

        // For DMs, get the other team's name
        let other_team_name: string | undefined;
        if (conv.type === 'dm') {
          const { data: others } = await supabase
            .from('chat_members')
            .select('team_id, teams(name)')
            .eq('conversation_id', mem.conversation_id)
            .neq('team_id', teamId!);
          other_team_name = (others?.[0] as any)?.teams?.name ?? 'Unknown';
        }

        previews.push({
          id: conv.id,
          league_id: conv.league_id,
          type: conv.type,
          created_at: conv.created_at,
          last_message: lastMsg?.content ?? null,
          last_message_at: lastMsg?.created_at ?? null,
          last_message_team_name: (lastMsg as any)?.teams?.name ?? null,
          unread_count: count ?? 0,
          other_team_name,
        });
      }

      // Sort: league chat first, then by last message time desc
      previews.sort((a, b) => {
        if (a.type === 'league' && b.type !== 'league') return -1;
        if (a.type !== 'league' && b.type === 'league') return 1;
        const aTime = a.last_message_at ?? a.created_at;
        const bTime = b.last_message_at ?? b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      return previews;
    },
    enabled: !!leagueId && !!teamId,
  });
}

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
        .select('id, conversation_id, team_id, content, created_at, teams(name)')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        team_id: m.team_id,
        content: m.content,
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
              content.length > 100 ? content.slice(0, 100) + '…' : content;
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
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ─── Reactions ───────────────────────────────────────────────

export function useReactions(
  conversationId: string | null,
  messageIds: string[],
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat_reactions_${conversationId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_reactions' },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['reactions', conversationId],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

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
        if (existing) {
          existing.count++;
          existing.team_names.push(tName);
        } else {
          groups.push({
            emoji: r.emoji,
            count: 1,
            reacted_by_me: false,
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
          .insert({ message_id: messageId, team_id: teamId, emoji });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['reactions', conversationId],
      });
    },
  });
}

// ─── Mark read ───────────────────────────────────────────────

export function useMarkRead(
  conversationId: string | null,
  teamId: string | null,
) {
  const queryClient = useQueryClient();
  const { leagueId } = useAppState();

  useEffect(() => {
    if (!conversationId || !teamId) return;
    supabase
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('team_id', teamId)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
        queryClient.invalidateQueries({ queryKey: ['chatUnread', leagueId] });
      });
  }, [conversationId, teamId, leagueId, queryClient]);
}

// ─── Create DM ───────────────────────────────────────────────

export function useCreateDM(leagueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      myTeamId,
      otherTeamId,
    }: {
      myTeamId: string;
      otherTeamId: string;
    }) => {
      // Check if DM already exists between these two teams in this league
      const { data: myConvos } = await supabase
        .from('chat_members')
        .select(
          'conversation_id, chat_conversations!inner(id, type, league_id)',
        )
        .eq('team_id', myTeamId)
        .eq('chat_conversations.league_id', leagueId)
        .eq('chat_conversations.type', 'dm');

      if (myConvos) {
        for (const row of myConvos) {
          const { data: otherMember } = await supabase
            .from('chat_members')
            .select('id')
            .eq('conversation_id', row.conversation_id)
            .eq('team_id', otherTeamId)
            .maybeSingle();
          if (otherMember) return row.conversation_id;
        }
      }

      // Create new DM
      const { data: conv, error: convErr } = await supabase
        .from('chat_conversations')
        .insert({ league_id: leagueId, type: 'dm' })
        .select()
        .single();
      if (convErr) throw convErr;

      const { error: memErr } = await supabase.from('chat_members').insert([
        { conversation_id: conv.id, team_id: myTeamId },
        { conversation_id: conv.id, team_id: otherTeamId },
      ]);
      if (memErr) throw memErr;

      return conv.id as string;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', leagueId] });
    },
  });
}

// ─── Unread badge count ──────────────────────────────────────

export function useTotalUnread() {
  const { leagueId, teamId } = useAppState();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`chat_unread_${leagueId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
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
      const { data: memberships, error } = await supabase
        .from('chat_members')
        .select(
          'conversation_id, last_read_at, chat_conversations!inner(league_id)',
        )
        .eq('team_id', teamId!)
        .eq('chat_conversations.league_id', leagueId!);
      if (error) throw error;

      let unread = 0;
      for (const mem of memberships ?? []) {
        const { count } = await supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', mem.conversation_id)
          .neq('team_id', teamId!)
          .gt('created_at', mem.last_read_at);
        if ((count ?? 0) > 0) unread++;
      }
      return unread;
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 30_000,
  });
}
