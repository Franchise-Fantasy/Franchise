// hooks/useDraftPlayer.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { globalToastRef } from '@/context/ToastProvider';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { Player } from '@/types/draft';

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
      const previousPlayers = queryClient.getQueryData<Player[]>(queryKeys.availablePlayers(leagueId));
      queryClient.setQueryData(queryKeys.availablePlayers(leagueId), (old: any[]) =>
        old ? old.filter(p => (p.id ?? p.player_id) !== selectedPlayer.id) : []
      );
      return { previousPlayers };
    },
    onError: (err, _player, context) => {
      if (context?.previousPlayers) {
        queryClient.setQueryData(queryKeys.availablePlayers(leagueId), context.previousPlayers);
      }
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