import { useEffect } from 'react';
import { queryKeys } from '@/constants/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Subscribes to realtime changes on league_players for a given league.
 * When a player is added, removed, or updated (e.g. from a waiver claim
 * or scheduled transaction), invalidates roster and matchup queries so
 * the UI picks up the change without needing a manual refresh or auto-sort.
 */
export function useRosterChanges(leagueId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`roster-changes-${leagueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_players',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          // Core roster queries — always needed
          queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
          queryClient.invalidateQueries({ queryKey: ['teamRosterStats'] });
          queryClient.invalidateQueries({ queryKey: ['leagueRosterStats'] });
          // Available players updates if a player was added/dropped
          queryClient.invalidateQueries({ queryKey: ['availablePlayers'] });
          // Matchup queries only need the current week's data refreshed
          // (player scores won't change from a roster move, but lineup slots might)
          queryClient.invalidateQueries({ queryKey: queryKeys.weekMatchup(leagueId!) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);
}
