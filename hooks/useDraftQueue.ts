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
  const queryKey = ['draftQueue', draftId, teamId];

  const { data: queue = [], isLoading } = useQuery<QueuedPlayer[]>({
    queryKey,
    queryFn: async () => {
      // Fetch queue entries
      const { data: entries, error } = await supabase
        .from('draft_queue')
        .select('id, player_id, priority')
        .eq('draft_id', draftId)
        .eq('team_id', teamId)
        .order('priority');

      if (error) throw error;
      if (!entries || entries.length === 0) return [];

      // Fetch already-drafted player IDs to filter out
      const { data: draftedPlayers } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);

      const draftedIds = new Set((draftedPlayers ?? []).map(p => String(p.player_id)));

      // Filter out drafted players
      const availableEntries = entries.filter(e => !draftedIds.has(String(e.player_id)));

      if (availableEntries.length === 0) return [];

      // Fetch player stats for remaining entries
      const playerIds = availableEntries.map(e => e.player_id);
      const { data: stats, error: statsError } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsError) throw statsError;

      const statsMap = new Map((stats as PlayerSeasonStats[]).map(s => [s.player_id, s]));

      return availableEntries
        .map(e => {
          const player = statsMap.get(e.player_id);
          if (!player) return null;
          return { queue_id: e.id, player_id: e.player_id, priority: e.priority, player };
        })
        .filter(Boolean) as QueuedPlayer[];
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
