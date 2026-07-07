import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

export type TickerEventKind =
  | 'MADE_3PT'
  | 'MADE_2PT'
  | 'MADE_FT'
  | 'MISSED_3PT'
  | 'MISSED_2PT'
  | 'MISSED_FT'
  | 'AST'
  | 'REB'
  | 'STL'
  | 'BLK'
  | 'TOV'
  | 'PF'
  | 'DD'
  | 'TD';

export interface TickerEvent {
  id: string;
  player_id: string;
  player_name: string;
  game_id: string;
  sport: string;
  kind: TickerEventKind;
  value: number;
  period: number | null;
  game_clock: string | null;
  occurred_at: string;
}

const TICKER_CAP = 24;

/**
 * Subscribes to live_scoring_events and exposes the most recent events for
 * a given roster of player_ids. Used by the matchup hero ticker.
 *
 * Pattern note: events arrive via a broadcast-from-DB trigger on the shared
 * `live-events` topic (event `scoring_event`) — the old UNFILTERED
 * postgres_changes WAL fanout was retired in the live_scoring_events_broadcast
 * migration. Broadcast has no server-side filter, so roster filtering stays
 * client-side against the current playerIds set; the global event volume is
 * small (~5–15 rows per 30s cycle across all live games).
 */
export function useMatchupTickerEvents(
  playerIds: string[],
  enabled: boolean,
): { events: TickerEvent[]; isLoading: boolean } {
  const queryClient = useQueryClient();

  // Stable comparable key — prevents the query from re-keying on every render
  // when playerIds is a fresh array but with the same contents.
  const playerIdsKey = useMemo(() => [...playerIds].sort().join(','), [playerIds]);

  const playerIdSet = useMemo(() => new Set(playerIds), [playerIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: events = [], isLoading } = useQuery<TickerEvent[]>({
    queryKey: queryKeys.matchupTickerEvents(playerIdsKey),
    queryFn: async () => {
      if (playerIds.length === 0) return [];
      // No time cutoff — the recap should always surface this roster's
      // most recent plays even if their last game ended an hour ago and
      // the next one hasn't tipped. The TICKER_CAP keeps the band bounded.
      const { data, error } = await supabase
        .from('live_scoring_events')
        .select('id, player_id, player_name, game_id, sport, kind, value, period, game_clock, occurred_at')
        .in('player_id', playerIds)
        .order('occurred_at', { ascending: false })
        .limit(TICKER_CAP);
      if (error) throw error;
      return (data ?? []) as TickerEvent[];
    },
    enabled: enabled && playerIds.length > 0,
    staleTime: 25_000,
    // Polling safety net. Realtime is the primary delivery mechanism (sub-
    // second), but the websocket can drop on iOS background/foreground
    // transitions or flaky networks. A 30s refetch ensures the ticker
    // converges on the truth even if a realtime payload is missed.
    refetchInterval: enabled && playerIds.length > 0 ? 30_000 : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!enabled || playerIds.length === 0) return;

    const channel = supabase
      .channel('live-events')
      .on(
        'broadcast',
        { event: 'scoring_event' },
        (message) => {
          const row = message.payload as TickerEvent | undefined;
          if (!row || !playerIdSet.has(row.player_id)) return;

          queryClient.setQueryData<TickerEvent[]>(
            queryKeys.matchupTickerEvents(playerIdsKey),
            (prev) => {
              const next = prev ? [row, ...prev] : [row];
              // De-dupe by id in case the realtime payload races the polling refetch
              const seen = new Set<string>();
              const deduped: TickerEvent[] = [];
              for (const e of next) {
                if (seen.has(e.id)) continue;
                seen.add(e.id);
                deduped.push(e);
                if (deduped.length >= TICKER_CAP) break;
              }
              return deduped;
            },
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // queryClient is a stable singleton — omitting prevents unnecessary teardowns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playerIdsKey, playerIdSet]);

  return { events, isLoading };
}
