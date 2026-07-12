import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/context/AuthProvider';
import { supabase } from '@/lib/supabase';

/**
 * Whether the signed-in user is an app admin (profiles.is_admin). Drives
 * admin-only UX like the NFL tile in the create-league SportSelector — this
 * is a UX gate only; the server-side counterpart is the leagues_nfl_admin_gate
 * BEFORE INSERT trigger, so a spoofed client still can't create gated leagues.
 * Defaults to false while loading / signed out.
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const session = useSession();
  const userId = session?.user?.id ?? null;

  const { data, isLoading } = useQuery<boolean>({
    queryKey: ['isAdmin', userId],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return row?.is_admin === true;
    },
    enabled: !!userId,
    staleTime: Infinity,
  });

  return { isAdmin: data === true, isLoading };
}
