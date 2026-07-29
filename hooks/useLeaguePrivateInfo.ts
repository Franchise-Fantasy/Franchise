import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export interface LeaguePrivateInfo {
  invite_code: string | null;
  venmo_username: string | null;
  cashapp_tag: string | null;
  paypal_username: string | null;
}

/**
 * The 4 sensitive league columns (invite code + the three payment handles) are
 * column-revoked from `authenticated` so a non-member can't harvest every
 * league's invite codes and commissioners' payment handles (migration
 * 20260729000200). They're served instead by the members-only SD RPC
 * `get_league_private_info`, which raises for non-members. This hook is the one
 * client entry point for that data — used by the home screen, league-info, and
 * EditBasicsModal. Returns null until it resolves (or if the caller isn't a
 * member, in which case the query errors and `data` stays undefined).
 */
export function useLeaguePrivateInfo(leagueId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['leaguePrivateInfo', leagueId],
    queryFn: async (): Promise<LeaguePrivateInfo | null> => {
      const { data, error } = await supabase.rpc('get_league_private_info', {
        p_league_id: leagueId!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as LeaguePrivateInfo) ?? null;
    },
    enabled: enabled && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}
