import { useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';

import { setSeasonConfigCache, type SeasonConfigRow, type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';

/**
 * Hydrates the in-memory season-config cache (constants/LeagueDefaults) from the
 * `season_config` table so current-season / opening-night metadata can be
 * updated via SQL without an app deploy. Falls back silently to the hardcoded
 * constants when the table is empty or unreachable, so it's a no-deploy override
 * rather than a hard dependency. Mount once near the app root.
 */
export function useSeasonConfig(): void {
  const { data } = useQuery({
    queryKey: ['seasonConfig'],
    queryFn: async (): Promise<SeasonConfigRow[]> => {
      const { data: rows, error } = await supabase
        .from('season_config')
        .select('sport, season, start_date, end_date, creation_opens_at, is_current');
      if (error) throw error;
      return (rows ?? []).map((r) => ({
        sport: r.sport as Sport,
        season: r.season,
        start_date: r.start_date,
        end_date: r.end_date,
        creation_opens_at: r.creation_opens_at,
        is_current: r.is_current,
      }));
    },
    staleTime: 1000 * 60 * 60, // 1h — season metadata changes at most a few times a year
    retry: 1,
  });

  useEffect(() => {
    if (data) setSeasonConfigCache(data);
  }, [data]);
}
