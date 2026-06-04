import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type GameProjectionRow =
  Database['public']['Tables']['player_projections']['Row'];

export interface GameProjections {
  /** The most recent next-game snapshot — powers the "next up" banner and the
   *  projected line on the nearest upcoming game-log row. */
  latest: GameProjectionRow | null;
  /** projection_date (YYYY-MM-DD) -> that day's next-game snapshot. A game on
   *  date D is matched to the snapshot stamped D (made the morning of), so the
   *  game log can show what we projected for each past game vs what happened. */
  byDate: Map<string, GameProjectionRow>;
}

const LOOKBACK_DAYS = 60;

/**
 * One player's `next_game` projection history, for the player-detail timeline:
 * the latest snapshot (forward / next game) plus every recent daily snapshot
 * keyed by date (backward / projected-vs-actual). Reads the `player_projections`
 * base table directly (not the latest-only view) so past snapshots are
 * available. Authenticated-readable, so no league scoping.
 */
export function usePlayerGameProjections(playerId: string, enabled = true) {
  const sport = useActiveLeagueSport();

  return useQuery<GameProjections>({
    queryKey: [...queryKeys.playerGameProjections(playerId), sport],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('player_projections')
        .select('*')
        .eq('sport', sport)
        .eq('player_id', playerId)
        .eq('horizon', 'next_game')
        .gte('projection_date', cutoffStr)
        .order('projection_date', { ascending: false });
      if (error) throw error;

      const byDate = new Map<string, GameProjectionRow>();
      for (const row of data ?? []) {
        if (row.projection_date) byDate.set(row.projection_date, row);
      }
      return { latest: data?.[0] ?? null, byDate };
    },
    enabled: enabled && !!playerId,
    staleTime: 1000 * 60 * 30,
  });
}
