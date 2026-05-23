import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { getPreviousSeason, type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import type { ScoringWeight } from '@/types/player';
import { seasonAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

/** Loads previous-season fpts-per-game for every player on the given list,
 *  keyed by player_id. Used as a fallback weight when the current season
 *  hasn't produced enough data to drive analytics (WNBA pre-tipoff is the
 *  motivating case). Mirrors the auto-lineup fallback in `app/(tabs)/roster.tsx`.
 *
 *  Returns an empty map when there are no players, no scoring weights, or
 *  no historical rows — callers should treat this as a transparent fallback. */
export function usePrevSeasonFpts(
  leagueId: string | null | undefined,
  sport: Sport,
  playerIds: string[],
  scoringWeights: ScoringWeight[] | undefined,
) {
  const previousSeason = getPreviousSeason(sport);

  return useQuery<Map<string, number>>({
    queryKey: queryKeys.prevSeasonFpts(leagueId ?? '', previousSeason),
    queryFn: async () => {
      const map = new Map<string, number>();
      if (playerIds.length === 0 || !scoringWeights || scoringWeights.length === 0) {
        return map;
      }
      const { data, error } = await supabase
        .from('player_historical_stats')
        .select('*')
        .eq('sport', sport)
        .eq('season', previousSeason)
        .in('player_id', playerIds);
      if (error) throw error;
      for (const row of data ?? []) {
        const pid = (row as { player_id?: string }).player_id;
        if (!pid) continue;
        const fpts = seasonAvgRowToFpts(row as Record<string, unknown>, scoringWeights);
        if (fpts > 0) map.set(pid, fpts);
      }
      return map;
    },
    enabled: !!leagueId && playerIds.length > 0 && (scoringWeights?.length ?? 0) > 0,
    staleTime: 1000 * 60 * 30,
  });
}
