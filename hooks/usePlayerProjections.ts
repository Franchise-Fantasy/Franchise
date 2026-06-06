import { useQuery } from '@tanstack/react-query';

import { getCurrentSeason, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type ProjectionRow =
  Database['public']['Views']['current_player_projections']['Row'];

export type ProjectionHorizon = 'season' | 'next_game';

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
  horizon: ProjectionHorizon = 'next_game',
  enabled = true,
) {
  return useQuery<Map<string, ProjectionRow>>({
    queryKey: queryKeys.playerProjections(sport, horizon),
    queryFn: async () => {
      const map = new Map<string, ProjectionRow>();
      // Pin the season: the `season` horizon carries both the current season
      // and a forward-looking next-year row per player (the view's DISTINCT ON
      // ties on date, not season), so without this filter ~20% of players get
      // their next-year projection. `next_game` is single-season, so this is a
      // no-op there.
      const { data, error } = await supabase
        .from('current_player_projections')
        .select('*')
        .eq('sport', sport)
        .eq('horizon', horizon)
        .eq('season', getCurrentSeason(sport));
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
