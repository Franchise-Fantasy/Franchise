import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/AuthProvider';
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export function useWatchlist() {
  const session = useSession();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();

  const { data: watchlistedIds = new Set<string>(), isLoading } = useQuery({
    queryKey: ['watchlist', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('watchlist')
        .select('player_id')
        .eq('user_id', userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.player_id as string));
    },
    enabled: !!userId,
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
      queryClient.setQueryData<Set<string>>(['watchlist', userId], (prev) => {
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
        queryClient.invalidateQueries({ queryKey: ['watchlist', userId] });
      }
    },
    [userId, watchlistedIds, queryClient],
  );

  const hasWatchlistData = useMemo(() => watchlistedIds.size > 0, [watchlistedIds]);

  return { watchlistedIds, isWatchlisted, toggleWatchlist, isLoading, hasWatchlistData };
}
