import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';

export interface LeaguePlayerWithTeam extends PlayerSeasonStats {
  team_id: string;
  // Roster slot ('IR', 'TAXI', 'BE', 'PG'…); null defaults to bench. Merged
  // from league_players so analytics can drop IR/TAXI from active-roster math.
  roster_slot: string | null;
}

export function useLeagueRosterStats(leagueId: string) {
  return useQuery<LeaguePlayerWithTeam[]>({
    queryKey: queryKeys.leagueRosterStats(leagueId),
    queryFn: async () => {
      // The RPC doesn't surface roster_slot, so fetch the slots alongside it
      // (league_players is small + indexed by league_id) and merge by player_id.
      const [statsRes, slotsRes] = await Promise.all([
        supabase.rpc('get_league_roster_stats', { p_league_id: leagueId }),
        supabase.from('league_players').select('player_id, roster_slot').eq('league_id', leagueId),
      ]);
      if (statsRes.error) throw statsRes.error;
      if (slotsRes.error) throw slotsRes.error;

      const slotByPlayer = new Map(
        (slotsRes.data ?? []).map((r) => [r.player_id, r.roster_slot]),
      );
      const rows = (statsRes.data ?? []) as unknown as LeaguePlayerWithTeam[];
      return rows.map((p) => ({ ...p, roster_slot: slotByPlayer.get(p.player_id) ?? null }));
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
