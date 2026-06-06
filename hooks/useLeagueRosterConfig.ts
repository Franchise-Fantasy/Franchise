import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

export interface RosterConfigSlot {
  position: string;
  slot_count: number;
}

// Canonical display order for roster slots. The bare WNBA tokens (G/F)
// interleave into the NBA spectrum — G sits after the guards, F after the
// forwards — so a WNBA config (G/F/C) renders G, F, C rather than the old
// C, G, F (C was ranked ahead of G/F). NBA configs never carry G/F slots, so
// their PG<SG<SF<PF<C order is unchanged. Mirrors POSITION_SLOT_ORDER in
// components/draft/TeamRoster.tsx.
const SLOT_ORDER: Record<string, number> = {
  PG: 0, SG: 1, G: 2, SF: 3, PF: 4, F: 5, C: 6,
  UTIL: 7, BE: 8, IR: 9,
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
