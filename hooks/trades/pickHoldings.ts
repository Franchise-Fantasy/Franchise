import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { HeldPick } from '@/utils/league/swapEligibility';

/**
 * Unused picks currently held by the teams in a trade, over the seasons/rounds
 * a pick swap can name. Feeds the swap picker's "can this swap ever convey?"
 * check via `projectPickHoldings` — see [swapEligibility.ts](../../utils/league/swapEligibility.ts).
 *
 * Scoped to the trade's teams (not the league) so the response stays a few
 * dozen rows: PostgREST truncates at 1000 with no error, and a league-wide
 * fetch over the current season's startup rounds could approach it.
 */
export function useTradePickHoldings(
  leagueId: string | null,
  teamIds: string[],
  seasons: string[],
  maxRound: number,
  enabled = true,
) {
  const sortedTeamIds = [...teamIds].sort();

  return useQuery<HeldPick[]>({
    queryKey: queryKeys.tradePickHoldings(leagueId!, sortedTeamIds, seasons, maxRound),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draft_picks')
        .select('season, round, current_team_id')
        .eq('league_id', leagueId!)
        .in('current_team_id', sortedTeamIds)
        .in('season', seasons)
        .lte('round', maxRound)
        .is('player_id', null);
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && !!leagueId && sortedTeamIds.length > 0 && seasons.length > 0,
    staleTime: 1000 * 60 * 5,
  });
}
