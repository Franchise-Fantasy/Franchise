import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface QueuedPlayer {
  queue_id: string;
  player_id: string;
  priority: number;
  player: PlayerSeasonStats;
}

export function useDraftQueue(draftId: string, teamId: string, leagueId: string) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.draftQueue(draftId, teamId);

  const { data: queue = [], isLoading } = useQuery<QueuedPlayer[]>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_draft_queue' as any, {
        p_draft_id: draftId,
        p_team_id: teamId,
        p_league_id: leagueId,
      });
      if (error) throw error;
      if (!data || data.length === 0) return [];

      return (data as any[]).map((row) => ({
        queue_id: row.queue_id,
        player_id: row.player_id,
        priority: row.priority,
        player: row as PlayerSeasonStats,
      }));
    },
    enabled: !!draftId && !!teamId,
  });

  const addToQueue = useMutation({
    mutationFn: async (playerId: string) => {
      // Get current max priority
      const { data: existing } = await supabase
        .from('draft_queue')
        .select('priority')
        .eq('draft_id', draftId)
        .eq('team_id', teamId)
        .order('priority', { ascending: false })
        .limit(1);

      const nextPriority = (existing?.[0]?.priority ?? 0) + 1;

      const { error } = await supabase.from('draft_queue').insert({
        draft_id: draftId,
        team_id: teamId,
        player_id: playerId,
        priority: nextPriority,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const removeFromQueue = useMutation({
    mutationFn: async (queueId: string) => {
      const { error } = await supabase.from('draft_queue').delete().eq('id', queueId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const moveUp = useMutation({
    mutationFn: async (index: number) => {
      if (index <= 0) return;
      const current = queue[index];
      const above = queue[index - 1];
      // Swap priorities
      await Promise.all([
        supabase.from('draft_queue').update({ priority: above.priority }).eq('id', current.queue_id),
        supabase.from('draft_queue').update({ priority: current.priority }).eq('id', above.queue_id),
      ]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const moveDown = useMutation({
    mutationFn: async (index: number) => {
      if (index >= queue.length - 1) return;
      const current = queue[index];
      const below = queue[index + 1];
      await Promise.all([
        supabase.from('draft_queue').update({ priority: below.priority }).eq('id', current.queue_id),
        supabase.from('draft_queue').update({ priority: current.priority }).eq('id', below.queue_id),
      ]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Set of player IDs currently in queue (for quick lookup)
  const queuedPlayerIds = new Set(queue.map(q => q.player_id));

  return {
    queue,
    isLoading,
    queuedPlayerIds,
    addToQueue: addToQueue.mutate,
    removeFromQueue: removeFromQueue.mutate,
    moveUp: moveUp.mutate,
    moveDown: moveDown.mutate,
    isAdding: addToQueue.isPending,
  };
}
