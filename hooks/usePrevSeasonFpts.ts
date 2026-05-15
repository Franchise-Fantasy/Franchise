import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { getPreviousSeason, type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';

// `player_historical_stats` only persists `total_*` for stats with a
// corresponding triple-double signal (pts/reb/ast/stl/blk/tov + dd/td). For
// shooting splits and personal fouls it only stores per-game averages — so
// reconstructing the totals here lets us reuse the canonical fpts helper
// without hand-rolling another formula. Without this step,
// calculateAvgFantasyPoints reads undefined for missing fields, multiplies
// by point_value, returns NaN, and `NaN > 0` is false — historical fpts
// never makes it into the fallback map and analytics stays empty.
const AVG_TO_TOTAL_RECONSTRUCT: Array<[avgKey: string, totalKey: keyof PlayerSeasonStats]> = [
  ['avg_fgm', 'total_fgm'],
  ['avg_fga', 'total_fga'],
  ['avg_3pm', 'total_3pm'],
  ['avg_3pa', 'total_3pa'],
  ['avg_ftm', 'total_ftm'],
  ['avg_fta', 'total_fta'],
  ['avg_pf', 'total_pf'],
];

function reconstructTotals(row: Record<string, unknown>): PlayerSeasonStats {
  const games = Number(row.games_played) || 0;
  const out: Record<string, unknown> = { ...row };
  for (const [avgKey, totalKey] of AVG_TO_TOTAL_RECONSTRUCT) {
    if (out[totalKey] != null) continue;
    const avg = Number(out[avgKey]);
    out[totalKey] = Number.isFinite(avg) ? Math.round(avg * games) : 0;
  }
  return out as unknown as PlayerSeasonStats;
}


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
        const fpts = calculateAvgFantasyPoints(
          reconstructTotals(row as Record<string, unknown>),
          scoringWeights,
        );
        if (fpts > 0) map.set(pid, fpts);
      }
      return map;
    },
    enabled: !!leagueId && playerIds.length > 0 && (scoringWeights?.length ?? 0) > 0,
    staleTime: 1000 * 60 * 30,
  });
}
