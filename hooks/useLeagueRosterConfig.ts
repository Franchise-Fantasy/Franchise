import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export interface RosterConfigSlot {
  position: string;
  slot_count: number;
}

export function useLeagueRosterConfig(leagueId: string) {
  return useQuery<RosterConfigSlot[]>({
    queryKey: ['leagueRosterConfig', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_roster_config')
        .select('position, slot_count')
        .eq('league_id', leagueId);

      if (error) throw error;
      return data as RosterConfigSlot[];
    },
    enabled: !!leagueId,
  });
}
