import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

export interface HistoricalSeasonStats {
  season: string;
  games_played: number;
  avg_pts: number;
  avg_reb: number;
  avg_ast: number;
  avg_stl: number;
  avg_blk: number;
  avg_tov: number;
  avg_min: number;
  avg_fgm: number;
  avg_fga: number;
  avg_3pm: number;
  avg_3pa: number;
  avg_ftm: number;
  avg_fta: number;
  avg_pf: number;
  // Season DD/TD counts — no avg_* column exists for these, so they must come
  // through as totals for seasonAvgRowToFpts to include the DD/TD scoring bonus
  // (otherwise the previous-season FPTS silently omits it — a big miss in
  // leagues that score double/triple-doubles).
  total_dd: number;
  total_td: number;
  pro_team: string | null;
  // NFL seasons persist only total_<col> columns (no avg_*) — the display
  // readers (SeasonAverages nflAvg, seasonAvgRowToFpts) divide by
  // games_played. Read via this index; the explicit fields above stay typed.
  [column: string]: unknown;
}

export function usePlayerHistoricalStats(playerId: string | null) {
  return useQuery<HistoricalSeasonStats[]>({
    queryKey: queryKeys.playerHistoricalStats(playerId!),
    queryFn: async () => {
      // select('*'), not a column list: this once listed only the basketball
      // columns, which silently stripped every NFL total_* column and blanked
      // the whole previous-seasons view for NFL players. It's ≤25 rows for a
      // single player, so the wide select costs nothing and can't drift when
      // sparse per-sport columns are added.
      const { data, error } = await supabase
        .from('player_historical_stats')
        .select('*')
        .eq('player_id', playerId!)
        .order('season', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as HistoricalSeasonStats[];
    },
    enabled: !!playerId,
    staleTime: 1000 * 60 * 30,
  });
}
