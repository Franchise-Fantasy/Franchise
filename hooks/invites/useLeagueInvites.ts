import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface LeagueInvite {
  id: string;
  invited_email: string;
  status: InviteStatus;
  team_id: string | null;
  created_at: string;
}

/**
 * Invitations sent for a league, for the commissioner's "sent invites" list.
 * RLS (`is_league_commissioner`) is what grants the read; a non-commissioner
 * gets an empty set. Cancelled rows are dropped — a resend after cancel makes
 * a fresh pending row, so old cancelled ones are just noise.
 */
export function useLeagueInvites(leagueId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.leagueInvites(leagueId ?? ''),
    enabled: !!leagueId && enabled,
    queryFn: async (): Promise<LeagueInvite[]> => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, invited_email, status, team_id, created_at')
        .eq('league_id', leagueId!)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeagueInvite[];
    },
  });

  return {
    invites: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
