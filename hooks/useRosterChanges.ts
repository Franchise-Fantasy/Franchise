import { useEffect } from 'react';
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
      .channel(`roster-changes-${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_players',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          // Invalidate all roster and matchup queries — React Query will refetch
          queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
          queryClient.invalidateQueries({ queryKey: ['teamRosterStats'] });
          queryClient.invalidateQueries({ queryKey: ['leagueRosterStats'] });
          queryClient.invalidateQueries({ queryKey: ['weekMatchup'] });
          queryClient.invalidateQueries({ queryKey: ['matchupById'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);
}
