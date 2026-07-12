import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';

/**
 * A league's enabled scoring weights, or `null` when it has none.
 *
 * The null matters. Every FPTS call site in the app guards with
 * `scoringWeights && …`, and an empty array is truthy — so a league with no
 * scoring rows used to sail straight through into
 * `calculateAvgFantasyPoints(player, [])`, which sums zero weights and returns
 * a perfectly confident **0**. The result was an FPTS column reading 0.0 for
 * every player and an FPTS sort that silently did nothing, with no hint that
 * the league was simply unconfigured. Returning null makes those guards mean
 * what they already look like they mean.
 */
export function useLeagueScoring(leagueId: string) {
  const query = useQuery<ScoringWeight[] | null>({
    queryKey: queryKeys.leagueScoring(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_scoring_settings')
        .select('stat_name, point_value, is_enabled, inverse')
        .eq('league_id', leagueId);

      if (error) throw error;

      // Only return enabled stats so disabled settings are never counted
      const weights = (data ?? [])
        .filter((row: any) => row.is_enabled)
        .map((row: any) => ({ stat_name: row.stat_name, point_value: row.point_value, inverse: row.inverse ?? false }));

      // react-query forbids `undefined` from a queryFn, so "none" is null here
      // and collapsed to undefined on the way out.
      return weights.length > 0 ? weights : null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });

  return { ...query, data: query.data ?? undefined };
}
