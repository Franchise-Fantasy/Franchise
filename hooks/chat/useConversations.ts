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
      // 1. Get all conversations I'm a member of in this league
      const { data: memberships, error: memErr } = await supabase
        .from('chat_members')
        .select(
          'conversation_id, last_read_at, team_id, chat_conversations!inner(id, league_id, type, created_at)',
        )
        .eq('team_id', teamId!)
        .eq('chat_conversations.league_id', leagueId!);
      if (memErr) throw memErr;
      if (!memberships || memberships.length === 0) return [];

      const convIds = memberships.map((m) => m.conversation_id);
      const dmConvIds = memberships
        .filter((m) => (m as any).chat_conversations.type === 'dm')
        .map((m) => m.conversation_id);

      // 2. Batch: latest message per conversation (single query)
      const { data: allLatestMsgs } = await supabase
        .from('chat_messages')
        .select('conversation_id, content, created_at, team_id, teams(name)')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false });

      // Keep only the newest message per conversation
      const latestByConv = new Map<string, NonNullable<typeof allLatestMsgs>[0]>();
      for (const msg of allLatestMsgs ?? []) {
        if (!latestByConv.has(msg.conversation_id)) {
          latestByConv.set(msg.conversation_id, msg);
        }
      }

      // 3. Batch: all unread messages across all conversations (single query)
      const oldestLastRead = memberships.reduce(
        (oldest, m) => (m.last_read_at < oldest ? m.last_read_at : oldest),
        memberships[0].last_read_at,
      );
      const { data: unreadMsgs } = await supabase
        .from('chat_messages')
        .select('conversation_id, created_at')
        .in('conversation_id', convIds)
        .neq('team_id', teamId!)
        .gt('created_at', oldestLastRead);

      // Count unread per conversation using each conversation's actual last_read_at
      const lastReadByConv = new Map<string, string>();
      for (const m of memberships) lastReadByConv.set(m.conversation_id, m.last_read_at);

      const unreadCountByConv = new Map<string, number>();
      for (const msg of unreadMsgs ?? []) {
        const convLastRead = lastReadByConv.get(msg.conversation_id)!;
        if (msg.created_at > convLastRead) {
          unreadCountByConv.set(msg.conversation_id, (unreadCountByConv.get(msg.conversation_id) ?? 0) + 1);
        }
      }

      // 4. Batch: DM other team names (single query)
      const dmOtherNames = new Map<string, string>();
      if (dmConvIds.length > 0) {
        const { data: dmMembers } = await supabase
          .from('chat_members')
          .select('conversation_id, team_id, teams(name)')
          .in('conversation_id', dmConvIds)
          .neq('team_id', teamId!);
        for (const dm of dmMembers ?? []) {
          dmOtherNames.set(dm.conversation_id, (dm as any).teams?.name ?? 'Unknown');
        }
      }

      // 5. Assemble previews (no additional queries)
      const previews: ConversationPreview[] = memberships.map((mem) => {
        const conv = (mem as any).chat_conversations;
        const lastMsg = latestByConv.get(mem.conversation_id) ?? null;
        return {
          id: conv.id,
          league_id: conv.league_id,
          type: conv.type,
          created_at: conv.created_at,
          last_message: lastMsg?.content ?? null,
          last_message_at: lastMsg?.created_at ?? null,
          last_message_team_name: (lastMsg as any)?.teams?.name ?? null,
          unread_count: unreadCountByConv.get(mem.conversation_id) ?? 0,
          other_team_name: dmOtherNames.get(mem.conversation_id),
        };
      });

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
    staleTime: 15_000,
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
      if (!memberships || memberships.length === 0) return 0;

      const convIds = memberships.map((m) => m.conversation_id);
      const oldestLastRead = memberships.reduce(
        (oldest, m) => (m.last_read_at < oldest ? m.last_read_at : oldest),
        memberships[0].last_read_at,
      );

      // Single query for all unread messages across all conversations
      const { data: unreadMsgs } = await supabase
        .from('chat_messages')
        .select('conversation_id, created_at')
        .in('conversation_id', convIds)
        .neq('team_id', teamId!)
        .gt('created_at', oldestLastRead);

      // Count conversations that have unread messages (using actual last_read_at per conv)
      const lastReadByConv = new Map<string, string>();
      for (const m of memberships) lastReadByConv.set(m.conversation_id, m.last_read_at);

      const convsWithUnread = new Set<string>();
      for (const msg of unreadMsgs ?? []) {
        const convLastRead = lastReadByConv.get(msg.conversation_id)!;
        if (msg.created_at > convLastRead) convsWithUnread.add(msg.conversation_id);
      }
      return convsWithUnread.size;
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 30_000,
  });
}
