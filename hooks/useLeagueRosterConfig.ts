import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export interface RosterConfigSlot {
  position: string;
  slot_count: number;
}

// Canonical display order for roster slots
const SLOT_ORDER: Record<string, number> = {
  PG: 0, SG: 1, SF: 2, PF: 3, C: 4,
  G: 5, F: 6, UTIL: 7, BE: 8, IR: 9,
};

export function useLeagueRosterConfig(leagueId: string) {
  return useQuery<RosterConfigSlot[]>({
    queryKey: queryKeys.leagueRosterConfig(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_roster_config')
        .select('position, slot_count')
        .eq('league_id', leagueId);

      if (error) throw error;
      return (data as RosterConfigSlot[]).sort(
        (a, b) => (SLOT_ORDER[a.position] ?? 99) - (SLOT_ORDER[b.position] ?? 99)
      );
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
}
