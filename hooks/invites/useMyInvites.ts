import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useSession } from '@/context/AuthProvider';
import { supabase } from '@/lib/supabase';

export interface MyInvite {
  id: string;
  league_id: string;
  team_id: string | null;
  created_at: string;
  league: {
    id: string;
    name: string;
    sport: string;
    imported_from: string | null;
  };
}

/**
 * Pending league invitations addressed to the signed-in user, newest first.
 *
 * The `!inner` join to `leagues` is load-bearing: `leagues_select` RLS hides
 * archived leagues, so an invite to an archived league drops out automatically
 * (its league row is invisible) even before archive_league cancels it — the
 * invitee can never be routed into a dead league.
 *
 * Cross-league by nature (the invitee isn't in these leagues yet), so this is
 * keyed to the user, not the active league.
 */
export function useMyInvites() {
  const session = useSession();
  const userId = session?.user?.id;

  const query = useQuery({
    queryKey: queryKeys.myInvites(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<MyInvite[]> => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, league_id, team_id, created_at, league:leagues!inner(id, name, sport, imported_from)')
        .eq('invited_user_id', userId!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MyInvite[];
    },
  });

  return {
    invites: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
