import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { useSession } from '@/context/AuthProvider';
import { supabase } from '@/lib/supabase';
import { migrateLocalDismissals } from '@/utils/dismissals/legacyLocalDismissals';
import { type DismissalKind, dismissalKey } from '@/utils/dismissals/types';
import { logger } from '@/utils/logger';

/**
 * Per-account "already seen" state for every one-time surface — commissioner
 * announcements, the matchup-result popup, CMS home banners, coach marks.
 *
 * This used to live in AsyncStorage, which is localStorage on web and therefore
 * per-browser-profile: every fresh web login replayed the whole backlog. It now
 * reads `user_dismissals`, so dismissing on any platform sticks on all of them.
 *
 * ONE query serves every surface. React Query dedupes by key, so the five call
 * sites share a single boot fetch and each does a synchronous Set lookup. Don't
 * add a per-surface query — the whole set is a few hundred rows at most.
 *
 * `ready` is false until the set is loaded. Callers MUST gate rendering on it,
 * or an already-dismissed modal flashes for a beat on every cold start while
 * the fetch is in flight.
 */
export function useDismissals() {
  const session = useSession();
  const userId = session?.user?.id ?? null;
  const queryClient = useQueryClient();

  const { data, isSuccess } = useQuery<Set<string>>({
    queryKey: queryKeys.dismissals(userId!),
    queryFn: async () => {
      // Inside the fetch rather than alongside it so the lift is guaranteed to
      // land BEFORE the first read resolves — running the two concurrently
      // races, and losing the race re-shows everything the local set covered.
      await migrateLocalDismissals(userId!);

      const { data: rows, error } = await supabase
        .from('user_dismissals')
        .select('kind, item_id')
        .eq('user_id', userId!);
      if (error) throw error;

      return new Set((rows ?? []).map((r) => dismissalKey(r.kind as DismissalKind, r.item_id)));
    },
    enabled: !!userId,
    // Dismissals only change through this hook (which updates the cache
    // directly), so there's nothing to poll for within a session.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const isDismissed = useCallback(
    (kind: DismissalKind, itemId: string) => data?.has(dismissalKey(kind, itemId)) ?? false,
    [data],
  );

  const dismiss = useCallback(
    (kind: DismissalKind, itemId: string) => {
      if (!userId) return;

      queryClient.setQueryData<Set<string>>(queryKeys.dismissals(userId), (prev) => {
        if (!prev) return prev;
        const key = dismissalKey(kind, itemId);
        if (prev.has(key)) return prev;
        return new Set(prev).add(key);
      });

      // Fire-and-forget: a failed write costs the user one repeat showing on
      // another device, which isn't worth blocking the dismiss animation on.
      // An async IIFE, not `.then()` — a Postgrest builder is a thenable, not a
      // real Promise, so it has no `.catch` for the network-failure path.
      void (async () => {
        try {
          const { error } = await supabase
            .from('user_dismissals')
            .upsert(
              { user_id: userId, kind, item_id: itemId },
              { onConflict: 'user_id,kind,item_id', ignoreDuplicates: true },
            );
          if (error) logger.warn('Persist dismissal failed', { kind, error: error.message });
        } catch (err) {
          logger.warn('Persist dismissal threw', err);
        }
      })();
    },
    [userId, queryClient],
  );

  return { ready: isSuccess, isDismissed, dismiss };
}
