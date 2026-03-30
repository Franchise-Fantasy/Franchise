import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

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
  nba_team: string | null;
}

export function usePlayerHistoricalStats(playerId: string | null) {
  return useQuery<HistoricalSeasonStats[]>({
    queryKey: ['playerHistoricalStats', playerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_historical_stats')
        .select(
          'season, games_played, avg_pts, avg_reb, avg_ast, avg_stl, avg_blk, avg_tov, avg_min, avg_fgm, avg_fga, avg_3pm, avg_3pa, avg_ftm, avg_fta, avg_pf, nba_team',
        )
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
