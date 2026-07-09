import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { sortSlotsBySport } from '@/utils/roster/rosterConfigOrder';

export interface RosterConfigSlot {
  position: string;
  slot_count: number;
}

export function useLeagueRosterConfig(leagueId: string) {
  return useQuery<RosterConfigSlot[]>({
    queryKey: queryKeys.leagueRosterConfig(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_roster_config')
        .select('position, slot_count')
        .eq('league_id', leagueId);

      if (error) throw error;
      // Sport-correct display order (NBA specific spots → flex → UTIL; WNBA
      // G, F, C). Pure + tested in rosterConfigOrder.test.ts.
      return sortSlotsBySport(data as RosterConfigSlot[]);
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
}
