import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ReadReceipt {
  team_id: string;
  team_name: string;
  tricode: string;
  last_read_message_id: string | null;
  online: boolean;
}

/** Query key used for the DB-backed read receipt seed. Prefetch this to avoid pop-in. */
export function readReceiptSeedKey(conversationId: string, myTeamId: string) {
  return ['readReceiptSeed', conversationId, myTeamId] as const;
}

/** Fetcher for the DB seed — exported so the chat list can prefetch it. */
export async function fetchReadReceiptSeed(conversationId: string, myTeamId: string) {
  const { data } = await supabase
    .from('chat_members')
    .select('team_id, last_read_message_id, teams!inner(name, tricode)')
    .eq('conversation_id', conversationId)
    .neq('team_id', myTeamId);

  if (!data) return {};

  const map: Record<string, ReadReceipt> = {};
  for (const row of data) {
    const team = row.teams as unknown as { name: string; tricode: string };
    map[row.team_id] = {
      team_id: row.team_id,
      team_name: team.name,
      tricode: team.tricode,
      last_read_message_id: row.last_read_message_id,
      online: false,
    };
  }
  return map;
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
  const [liveState, setLiveState] = useState<Record<string, ReadReceipt>>({});
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null);
  // Track which teams are currently online via presence
  const onlineRef = useRef<Set<string>>(new Set());

  // DB seed via React Query — can be prefetched from the chat list screen
  const { data: dbSeed } = useQuery({
    queryKey: readReceiptSeedKey(conversationId!, myTeamId!),
    queryFn: () => fetchReadReceiptSeed(conversationId!, myTeamId!),
    enabled: !!conversationId && !!myTeamId,
    staleTime: 1000 * 60 * 5,
  });

  // Presence channel for live updates
  useEffect(() => {
    if (!conversationId || !myTeamId || !myTeamName) return;

    // Presence channels require a shared deterministic name (no Date.now() suffix)
    // so all clients can see each other. The postgres_changes Date.now() rule
    // does not apply here — presence routing depends on matching names.
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
      setLiveState((prev) => {
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

  // Merge: DB seed as base, live presence updates on top
  const mergedState = useMemo(() => {
    const merged = { ...(dbSeed ?? {}) };
    // Layer live presence data on top of DB seed
    for (const [teamId, receipt] of Object.entries(liveState)) {
      merged[teamId] = receipt;
    }
    // For DB-seeded entries not yet updated by presence, update online status
    for (const teamId of Object.keys(merged)) {
      if (!liveState[teamId]) {
        merged[teamId] = { ...merged[teamId], online: onlineRef.current.has(teamId) };
      }
    }
    return merged;
  }, [dbSeed, liveState]);

  const receipts = useMemo(() => Object.values(mergedState), [mergedState]);

  return { receipts, updateReadPosition, presenceState: mergedState };
}
