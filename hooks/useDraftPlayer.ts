// hooks/useDraftPlayer.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { globalToastRef } from '@/context/ToastProvider';
import { capture } from '@/lib/posthog';
import { DB_REGION_HEADERS, supabase } from '@/lib/supabase';
import { Pick, Player } from '@/types/draft';

// Define the Player type here as well, or in a shared types file

// The hook now accepts leagueId and draftId as arguments
export const useDraftPlayer = (leagueId: string, draftId: string ) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (player: Player) => {
      const { data, error } = await supabase.functions.invoke('make-draft-pick', {
        body: {
          draft_id: draftId,
          player_id: player.id,
          player_position: player.position,
          league_id: leagueId,
        },
        headers: DB_REGION_HEADERS,
      });

      if (error) {
        // FunctionsHttpError surfaces "non-2xx" by default; the real
        // HttpError message lives in the response body (e.g. position-limit
        // violations from make-draft-pick).
        let detail = error.message;
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (body?.error) detail = body.error;
        } catch {
          // Body wasn't JSON — keep the fallback.
        }
        throw new Error(detail);
      }
      return data;
    },
    onSuccess: (_data, selectedPlayer) => {
      capture('draft_pick_made', {
        player_name: selectedPlayer.name,
        position: selectedPlayer.position,
        draft_id: draftId,
      });
    },
    onMutate: async (selectedPlayer: Player) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.availablePlayers(leagueId) });
      await queryClient.cancelQueries({ queryKey: ['draftOrder', draftId] });

      const previousPlayers = queryClient.getQueryData<Player[]>(queryKeys.availablePlayers(leagueId));
      // The draftOrder key carries a picks_per_round segment, so snapshot every
      // matching cache entry for rollback rather than a single exact key.
      const previousDraftOrder = queryClient.getQueriesData<Pick[]>({ queryKey: ['draftOrder', draftId] });

      // Remove the drafted player from the available pool.
      queryClient.setQueryData(queryKeys.availablePlayers(leagueId), (old: any[]) =>
        old ? old.filter(p => (p.id ?? p.player_id) !== selectedPlayer.id) : []
      );

      // Fill the on-the-clock pick card immediately so the player shows without
      // waiting on the edge round-trip + refetch. The current pick is always the
      // first unmade pick (the server only lets you fill your own current pick),
      // so filling the first player_id-less row is safe. The gold flash + haptic
      // fire off this null→player_id transition (see DraftOrder's picks watcher).
      queryClient.setQueriesData<Pick[]>({ queryKey: ['draftOrder', draftId] }, (old) => {
        if (!old) return old;
        const idx = old.findIndex((p) => !p.player_id);
        if (idx === -1) return old;
        const next = old.slice();
        next[idx] = {
          ...next[idx],
          player_id: selectedPlayer.id,
          player: {
            name: selectedPlayer.name,
            position: selectedPlayer.position,
            pro_team: selectedPlayer.pro_team,
          },
        };
        return next;
      });

      return { previousPlayers, previousDraftOrder };
    },
    onError: (err, _player, context) => {
      if (context?.previousPlayers) {
        queryClient.setQueryData(queryKeys.availablePlayers(leagueId), context.previousPlayers);
      }
      // Roll back the optimistic pick-card fill on failure (e.g. the player was
      // just taken, or a position-limit rejection).
      context?.previousDraftOrder?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      globalToastRef.current?.('error', (err as Error).message || 'Failed to draft player');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.availablePlayers(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
      queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
      queryClient.invalidateQueries({ queryKey: ['draftQueue'] });
    },
  });
};