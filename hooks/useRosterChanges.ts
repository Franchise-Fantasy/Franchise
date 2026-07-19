import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { supabase, uniqueChannelTopic } from '@/lib/supabase';

const COALESCE_MS = 250;

type RosterEventKind = 'add' | 'drop' | 'update';

// Ref-counted per-league subscription: the roster tab, matchup tab, and draft
// room all mount this hook at once, and each used to open its OWN
// league_players channel — triple realtime fanout and triple invalidation
// cycles for identical work. One subscription per league lives here; hooks
// just acquire/release it.
const activeSubs = new Map<string, { count: number; cleanup: () => void }>();

function createRosterSubscription(leagueId: string, queryClient: QueryClient): () => void {
  const pendingKinds = new Set<RosterEventKind>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    const kinds = new Set(pendingKinds);
    pendingKinds.clear();
    if (kinds.size === 0) return;

    // Roster slot membership ALWAYS changes for any league_players write
    queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
    queryClient.invalidateQueries({ queryKey: ['teamRosterStats'] });
    queryClient.invalidateQueries({ queryKey: ['leagueRosterStats'] });

    // Available pool only changes when players move in/out of league_players
    if (kinds.has('add') || kinds.has('drop')) {
      queryClient.invalidateQueries({ queryKey: ['availablePlayers'] });
    }
    // Matchup lineup slots can shift on add/drop; pure UPDATEs to existing
    // rows (e.g., position change) shouldn't blow this cache
    if (kinds.has('add') || kinds.has('drop')) {
      queryClient.invalidateQueries({ queryKey: queryKeys.weekMatchup(leagueId) });
    }
  };

  const enqueue = (kind: RosterEventKind) => {
    pendingKinds.add(kind);
    if (flushTimer) return;
    flushTimer = setTimeout(flush, COALESCE_MS);
  };

  const channel = supabase
    .channel(uniqueChannelTopic(`roster-changes-${leagueId}`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'league_players',
        filter: `league_id=eq.${leagueId}`,
      },
      (payload) => {
        if (payload.eventType === 'INSERT') enqueue('add');
        else if (payload.eventType === 'DELETE') enqueue('drop');
        else enqueue('update');
      },
    )
    .subscribe();

  return () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribes to realtime changes on league_players for a given league.
 * Coalesces bursts (e.g. process-waivers writes 50 rows in 30s) into a
 * single invalidation cycle, and invalidates only the keys relevant to
 * each event kind to avoid storming React Query with 5x cache thrash.
 * Safe to mount from multiple screens — the underlying subscription is
 * shared and ref-counted.
 */
export function useRosterChanges(leagueId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;

    let entry = activeSubs.get(leagueId);
    if (!entry) {
      entry = { count: 0, cleanup: createRosterSubscription(leagueId, queryClient) };
      activeSubs.set(leagueId, entry);
    }
    entry.count++;

    return () => {
      const e = activeSubs.get(leagueId);
      if (!e) return;
      e.count--;
      if (e.count <= 0) {
        activeSubs.delete(leagueId);
        e.cleanup();
      }
    };
    // queryClient is a stable singleton — omitting prevents unnecessary channel teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);
}
