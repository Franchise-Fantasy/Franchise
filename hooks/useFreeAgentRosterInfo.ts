import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

// Roster head-count + the league settings the free-agent list needs to gate
// adds/claims/trades. Extracted from FreeAgentList so the query is reusable
// and the component stays under the oversized-file line.
export function useFreeAgentRosterInfo(leagueId: string, teamId: string) {
  return useQuery({
    queryKey: queryKeys.freeAgentRosterInfo(leagueId, teamId),
    queryFn: async () => {
      const [allPlayersRes, inactivePlayersRes, leagueRes] = await Promise.all([
        supabase
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId),
        supabase
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          // IR and TAXI are both non-active — must match isActiveSlot in
          // utils/roster/rosterCutsShared.ts or taxi-heavy teams see phantom
          // "roster full" prompts.
          .in('roster_slot', ['IR', 'TAXI']),
        supabase
          .from('leagues')
          .select(
            'roster_size, waiver_type, offseason_step, weekly_acquisition_limit, position_limits, ir_trading_enabled',
          )
          .eq('id', leagueId)
          .single(),
      ]);
      if (allPlayersRes.error) throw allPlayersRes.error;
      if (inactivePlayersRes.error) throw inactivePlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;
      const activeCount =
        (allPlayersRes.count ?? 0) - (inactivePlayersRes.count ?? 0);
      return {
        activeCount,
        maxSize: leagueRes.data?.roster_size ?? 13,
        waiverType: (leagueRes.data?.waiver_type ?? 'none') as
          | 'standard'
          | 'faab'
          | 'none',
        offseasonStep: leagueRes.data?.offseason_step as string | null,
        weeklyAcquisitionLimit: leagueRes.data?.weekly_acquisition_limit as
          | number
          | null,
        positionLimits: leagueRes.data?.position_limits as
          | Record<string, number>
          | null,
        // Read path: default FALSE (blocking) when the cached row predates
        // the column.
        irTradingEnabled: leagueRes.data?.ir_trading_enabled ?? false,
      };
    },
    enabled: !!leagueId && !!teamId,
    placeholderData: (prev: any) => prev,
  });
}
