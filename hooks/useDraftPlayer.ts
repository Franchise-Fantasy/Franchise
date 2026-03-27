// hooks/useDraftPlayer.ts

import { globalToastRef } from '@/context/ToastProvider';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { Player } from '@/types/draft';
import { useMutation, useQueryClient } from '@tanstack/react-query';

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

      if (error) throw new Error(error.message);
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
      await queryClient.cancelQueries({ queryKey: ['availablePlayers', leagueId] });
      const previousPlayers = queryClient.getQueryData<Player[]>(['availablePlayers', leagueId]);
      queryClient.setQueryData(['availablePlayers', leagueId], (old: any[]) =>
        old ? old.filter(p => (p.id ?? p.player_id) !== selectedPlayer.id) : []
      );
      return { previousPlayers };
    },
    onError: (err, _player, context) => {
      if (context?.previousPlayers) {
        queryClient.setQueryData(['availablePlayers', leagueId], context.previousPlayers);
      }
      globalToastRef.current?.('error', (err as Error).message || 'Failed to draft player');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['availablePlayers', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
      queryClient.invalidateQueries({ queryKey: ['draftState', draftId] });
      queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
      queryClient.invalidateQueries({ queryKey: ['draftQueue'] });
    },
  });
};