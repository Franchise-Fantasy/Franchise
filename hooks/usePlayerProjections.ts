import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type ProjectionRow =
  Database['public']['Views']['current_player_projections']['Row'];

export type ProjectionHorizon = 'season' | 'ros';

/** Loads the latest projection per player for a sport + horizon, keyed by
 *  player_id. These are global reference data (not league-scoped, produced by
 *  the external projections engine), so the cache key is just (sport, horizon)
 *  and is shared across every league the user belongs to.
 *
 *  Returns the RAW projected per-game stat line. Projected fantasy points are
 *  league-specific and derived by the caller via `projAvgRowToFpts`
 *  (utils/scoring/fantasyPoints.ts) — mirrors how season-stat fpts work. */
export function usePlayerProjections(
  sport: Sport,
  horizon: ProjectionHorizon = 'ros',
  enabled = true,
) {
  return useQuery<Map<string, ProjectionRow>>({
    queryKey: queryKeys.playerProjections(sport, horizon),
    queryFn: async () => {
      const map = new Map<string, ProjectionRow>();
      const { data, error } = await supabase
        .from('current_player_projections')
        .select('*')
        .eq('sport', sport)
        .eq('horizon', horizon);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.player_id) map.set(row.player_id, row);
      }
      return map;
    },
    enabled,
    staleTime: 1000 * 60 * 30,
  });
}
