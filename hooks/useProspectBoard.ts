import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { ProspectBoardRow } from '@/types/prospect';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Fetch the current user's prospect board, ordered by rank. */
export function useProspectBoard(userId: string | undefined) {
  return useQuery<ProspectBoardRow[]>({
    queryKey: queryKeys.prospectBoard(userId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospect_boards')
        .select('*')
        .eq('user_id', userId!)
        .order('rank', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}

/** Reorder the board after drag-and-drop. Batch-updates rank values. */
export function useReorderBoard(userId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (orderedPlayerIds: string[]) => {
      const updates = orderedPlayerIds.map((playerId, index) =>
        supabase
          .from('prospect_boards')
          .update({ rank: index + 1, updated_at: new Date().toISOString() })
          .eq('user_id', userId!)
          .eq('player_id', playerId),
      );
      const results = await Promise.all(updates);
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prospectBoard(userId!) });
    },
  });
}

/** Add a prospect to the board at the end. */
export function useAddToBoard(userId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (playerId: string) => {
      // Get current max rank
      const { data: existing } = await supabase
        .from('prospect_boards')
        .select('rank')
        .eq('user_id', userId!)
        .order('rank', { ascending: false })
        .limit(1);

      const nextRank = (existing?.[0]?.rank ?? 0) + 1;

      const { error } = await supabase
        .from('prospect_boards')
        .insert({
          user_id: userId!,
          player_id: playerId,
          rank: nextRank,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prospectBoard(userId!) });
    },
  });
}

/** Remove a prospect from the board. */
export function useRemoveFromBoard(userId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (playerId: string) => {
      const { error } = await supabase
        .from('prospect_boards')
        .delete()
        .eq('user_id', userId!)
        .eq('player_id', playerId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prospectBoard(userId!) });
    },
  });
}

/** Update notes on a board entry. */
export function useUpdateBoardNotes(userId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ playerId, notes }: { playerId: string; notes: string }) => {
      const { error } = await supabase
        .from('prospect_boards')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('user_id', userId!)
        .eq('player_id', playerId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prospectBoard(userId!) });
    },
  });
}
