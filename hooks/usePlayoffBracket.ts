import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { PlayoffBracketSlot, PlayoffSeedPick } from '@/types/playoff';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

export function usePlayoffBracket(season: string) {
  const { leagueId } = useAppState();

  return useQuery({
    queryKey: ['playoffBracket', leagueId, season],
    queryFn: async (): Promise<PlayoffBracketSlot[]> => {
      const { data, error } = await supabase
        .from('playoff_bracket')
        .select('*')
        .eq('league_id', leagueId!)
        .eq('season', season)
        .order('round', { ascending: true })
        .order('bracket_position', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && !!season,
    staleTime: 1000 * 60 * 2,
  });
}

export function useSeedPicks(season: string, round: number | null, poll = false) {
  const { leagueId } = useAppState();
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['seedPicks', leagueId, season, round],
    queryFn: async (): Promise<PlayoffSeedPick[]> => {
      const { data, error } = await supabase
        .from('playoff_seed_picks')
        .select('*')
        .eq('league_id', leagueId!)
        .eq('season', season)
        .eq('round', round!)
        .order('picking_seed', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && !!season && round !== null,
    staleTime: 1000 * 60 * 5,
  });

  // Real-time subscription replaces polling
  useEffect(() => {
    if (!poll || !leagueId || round === null) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    const channel = supabase
      .channel(`seed-picks-${leagueId}-${season}-${round}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'playoff_seed_picks',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['seedPicks', leagueId, season, round] });
          // Also refresh pending seed pick since a pick was made
          queryClient.invalidateQueries({ queryKey: ['pendingSeedPick', leagueId] });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [poll, leagueId, season, round, queryClient]);

  return query;
}

/** Returns the current user's pending seed pick for the active round, or null. */
export function usePendingSeedPick(season: string, poll = false) {
  const { leagueId, teamId } = useAppState();

  // Real-time invalidation is handled by useSeedPicks above,
  // so this hook only needs a standard query — no polling needed.
  return useQuery({
    queryKey: ['pendingSeedPick', leagueId, teamId, season],
    queryFn: async (): Promise<PlayoffSeedPick | null> => {
      const { data, error } = await supabase
        .from('playoff_seed_picks')
        .select('*')
        .eq('league_id', leagueId!)
        .eq('picking_team_id', teamId!)
        .eq('season', season)
        .is('picked_opponent_id', null)
        .order('round', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId && !!teamId && !!season,
    staleTime: 1000 * 60 * 5,
  });
}
