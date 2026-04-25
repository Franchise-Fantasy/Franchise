import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { useSession } from '@/context/AuthProvider';
import { supabase } from '@/lib/supabase';

export function useWatchlist() {
  const session = useSession();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();

  const { data: watchlistedIds = new Set<string>(), isLoading } = useQuery({
    queryKey: queryKeys.watchlist(userId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('watchlist')
        .select('player_id')
        .eq('user_id', userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.player_id as string));
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 30,
  });

  const isWatchlisted = useCallback(
    (playerId: string) => watchlistedIds.has(playerId),
    [watchlistedIds],
  );

  const toggleWatchlist = useCallback(
    async (playerId: string) => {
      if (!userId) return;
      const removing = watchlistedIds.has(playerId);

      // Optimistic update
      queryClient.setQueryData<Set<string>>(queryKeys.watchlist(userId!), (prev) => {
        const next = new Set(prev);
        if (removing) next.delete(playerId);
        else next.add(playerId);
        return next;
      });

      try {
        if (removing) {
          await supabase
            .from('watchlist')
            .delete()
            .eq('user_id', userId)
            .eq('player_id', playerId);
        } else {
          await supabase
            .from('watchlist')
            .insert({ user_id: userId, player_id: playerId });
        }
      } catch {
        // Revert on failure
        queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(userId!) });
      }
    },
    [userId, watchlistedIds, queryClient],
  );

  const hasWatchlistData = useMemo(() => watchlistedIds.size > 0, [watchlistedIds]);

  return { watchlistedIds, isWatchlisted, toggleWatchlist, isLoading, hasWatchlistData };
}
