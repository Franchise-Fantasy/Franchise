import { supabase } from '@/lib/supabase';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ReadReceipt {
  team_id: string;
  team_name: string;
  tricode: string;
  last_read_message_id: string | null;
  online: boolean;
}

/**
 * Loads read receipts from the DB on mount, then merges live Presence updates.
 * DB-backed receipts persist even when other members leave the chat screen,
 * so the "Seen" indicator never flickers away.
 */
export function useReadReceipts(
  conversationId: string | null,
  myTeamId: string | null,
  myTeamName: string | null,
  myTricode: string | null,
) {
  const [state, setState] = useState<Record<string, ReadReceipt>>({});
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null);
  // Track which teams are currently online via presence
  const onlineRef = useRef<Set<string>>(new Set());

  // Seed from DB so receipts are available immediately and persist offline
  useEffect(() => {
    if (!conversationId || !myTeamId) return;

    supabase
      .from('chat_members')
      .select('team_id, last_read_message_id, teams!inner(name, tricode)')
      .eq('conversation_id', conversationId)
      .neq('team_id', myTeamId)
      .then(({ data }) => {
        if (!data) return;
        setState((prev) => {
          const next = { ...prev };
          for (const row of data) {
            const team = row.teams as unknown as { name: string; tricode: string };
            // Only seed if presence hasn't already provided a newer value
            if (!next[row.team_id]) {
              next[row.team_id] = {
                team_id: row.team_id,
                team_name: team.name,
                tricode: team.tricode,
                last_read_message_id: row.last_read_message_id,
                online: onlineRef.current.has(row.team_id),
              };
            }
          }
          return next;
        });
      });
  }, [conversationId, myTeamId]);

  // Presence channel for live updates
  useEffect(() => {
    if (!conversationId || !myTeamId || !myTeamName) return;

    const ch = supabase.channel(`chat_presence_${conversationId}`, {
      config: { presence: { key: myTeamId } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const presState = ch.presenceState<{
        team_id: string;
        team_name: string;
        tricode: string;
        last_read_message_id: string | null;
      }>();

      // Build set of currently online teams
      const nowOnline = new Set<string>();
      const updates: Record<string, ReadReceipt> = {};

      for (const [teamId, presences] of Object.entries(presState)) {
        if (teamId === myTeamId) continue;
        nowOnline.add(teamId);
        const latest = presences[presences.length - 1];
        if (latest) {
          updates[teamId] = {
            team_id: teamId,
            team_name: latest.team_name,
            tricode: latest.tricode,
            last_read_message_id: latest.last_read_message_id,
            online: true,
          };
        }
      }
      onlineRef.current = nowOnline;

      // Merge: presence updates override, but keep DB-seeded entries for offline users
      setState((prev) => {
        const next = { ...prev };
        // Update online status for all known members
        for (const teamId of Object.keys(next)) {
          next[teamId] = { ...next[teamId], online: nowOnline.has(teamId) };
        }
        // Apply presence updates (these have the freshest last_read_message_id)
        for (const [teamId, receipt] of Object.entries(updates)) {
          next[teamId] = receipt;
        }
        return next;
      });
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const { data } = await supabase
          .from('chat_members')
          .select('last_read_message_id')
          .eq('conversation_id', conversationId)
          .eq('team_id', myTeamId)
          .single();

        await ch.track({
          team_id: myTeamId,
          team_name: myTeamName,
          tricode: myTricode ?? myTeamName.slice(0, 3).toUpperCase(),
          last_read_message_id: data?.last_read_message_id ?? null,
        });
      }
    });

    setChannel(ch);

    return () => {
      supabase.removeChannel(ch);
      setChannel(null);
    };
  }, [conversationId, myTeamId, myTeamName, myTricode]);

  const updateReadPosition = useMemo(() => {
    if (!channel || !myTeamId || !myTeamName) return null;
    return (messageId: string) => {
      channel.track({
        team_id: myTeamId,
        team_name: myTeamName,
        tricode: myTricode ?? myTeamName.slice(0, 3).toUpperCase(),
        last_read_message_id: messageId,
      });
    };
  }, [channel, myTeamId, myTeamName, myTricode]);

  const receipts = useMemo(() => Object.values(state), [state]);

  return { receipts, updateReadPosition, presenceState: state };
}
