import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

const COALESCE_MS = 250;

type RosterEventKind = 'add' | 'drop' | 'update';

/**
 * Subscribes to realtime changes on league_players for a given league.
 * Coalesces bursts (e.g. process-waivers writes 50 rows in 30s) into a
 * single invalidation cycle, and invalidates only the keys relevant to
 * each event kind to avoid storming React Query with 5x cache thrash.
 */
export function useRosterChanges(leagueId: string | null) {
  const queryClient = useQueryClient();
  const pendingKindsRef = useRef<Set<RosterEventKind>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!leagueId) return;

    const flush = () => {
      flushTimerRef.current = null;
      const kinds = pendingKindsRef.current;
      pendingKindsRef.current = new Set();
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
      pendingKindsRef.current.add(kind);
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(flush, COALESCE_MS);
    };

    const channel = supabase
      .channel(`roster-changes-${leagueId}-${Date.now()}`)
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
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
    // queryClient is a stable singleton — omitting prevents unnecessary channel teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);
}
