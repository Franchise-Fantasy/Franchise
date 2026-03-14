import { useAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { PlayoffBracketSlot, PlayoffSeedPick } from '@/types/playoff';
import { useQuery } from '@tanstack/react-query';

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

  return useQuery({
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
    staleTime: 1000 * 60,
    refetchInterval: poll ? 1000 * 10 : false,
  });
}

/** Returns the current user's pending seed pick for the active round, or null. */
export function usePendingSeedPick(season: string, poll = false) {
  const { leagueId, teamId } = useAppState();

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
    staleTime: 1000 * 30,
    refetchInterval: poll ? 1000 * 10 : false,
  });
}
