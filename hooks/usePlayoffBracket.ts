import { useAppState } from '@/context/AppStateProvider';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PlayoffBracketSlot, PlayoffSeedPick } from '@/types/playoff';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

export function usePlayoffBracket(season: string) {
  const { leagueId } = useAppState();
  const queryClient = useQueryClient();

  const bracketQuery = useQuery({
    queryKey: queryKeys.playoffBracket(leagueId!, Number(season)),
    queryFn: async (): Promise<{ slots: PlayoffBracketSlot[]; scheduleIds: string[] }> => {
      const { data, error } = await supabase
        .from('playoff_bracket')
        .select('*, league_matchups(home_score, away_score, home_team_id, schedule_id)')
        .eq('league_id', leagueId!)
        .eq('season', season)
        .order('round', { ascending: true })
        .order('bracket_position', { ascending: true });
      if (error) throw error;

      const scheduleIdSet = new Set<string>();

      const slots = (data ?? []).map((row: any) => {
        const m = row.league_matchups;
        const slot: PlayoffBracketSlot = { ...row };
        delete (slot as any).league_matchups;
        if (m) {
          const homeIsA = m.home_team_id === row.team_a_id;
          slot.team_a_score = homeIsA ? m.home_score : m.away_score;
          slot.team_b_score = homeIsA ? m.away_score : m.home_score;
          if (m.schedule_id && !row.winner_id) scheduleIdSet.add(m.schedule_id);
        }
        return slot;
      });

      return { slots, scheduleIds: [...scheduleIdSet] };
    },
    enabled: !!leagueId && !!season,
    staleTime: 1000 * 60 * 2,
  });

  const scheduleIds = bracketQuery.data?.scheduleIds ?? [];

  // Fetch live scores from week_scores for active (non-finalized) playoff matchups
  const liveScoresQuery = useQuery({
    queryKey: queryKeys.playoffLiveScores(leagueId!, Number(season), scheduleIds),
    queryFn: async (): Promise<Record<string, number>> => {
      if (scheduleIds.length === 0) return {};
      const { data, error } = await supabase
        .from('week_scores')
        .select('team_id, score')
        .in('schedule_id', scheduleIds);
      if (error) throw error;
      const scores: Record<string, number> = {};
      for (const row of data ?? []) scores[row.team_id] = Number(row.score);
      return scores;
    },
    enabled: !!leagueId && scheduleIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  // Subscribe to week_scores changes for live score updates
  const channelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);
  useEffect(() => {
    if (!leagueId || scheduleIds.length === 0) {
      for (const ch of channelsRef.current) supabase.removeChannel(ch);
      channelsRef.current = [];
      return;
    }

    // Subscribe to broadcast for each active playoff schedule.
    // The edge function broadcasts all scores per schedule_id after upsert.
    const channels = scheduleIds.map((sid) =>
      supabase
        .channel(`playoff-scores-${sid}-${Date.now()}`)
        .on(
          'broadcast',
          { event: 'score_update' },
          (payload) => {
            const scores = payload.payload?.scores as Record<string, number> | undefined;
            if (scores) {
              queryClient.setQueryData(
                queryKeys.playoffLiveScores(leagueId!, Number(season), scheduleIds),
                (old: Record<string, number> | undefined) => ({
                  ...old,
                  ...Object.fromEntries(
                    Object.entries(scores).map(([k, v]) => [k, Number(v)]),
                  ),
                }),
              );
            }
          },
        )
        .subscribe(),
    );

    channelsRef.current = channels;

    return () => {
      for (const ch of channels) supabase.removeChannel(ch);
      channelsRef.current = [];
    };
    // scheduleIds is a fresh array reference each render; joining to a string gives us a
    // stable value dep so the effect only re-runs when the set of ids actually changes.
    // queryClient is a stable singleton.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, season, scheduleIds.join(',')]);

  // Merge live scores onto bracket slots
  const liveScores = liveScoresQuery.data ?? {};
  const slots = useMemo(() => {
    const baseSlots = bracketQuery.data?.slots;
    if (!baseSlots) return undefined;
    if (Object.keys(liveScores).length === 0) return baseSlots;

    return baseSlots.map((slot) => {
      // Only overlay live scores for active (non-finalized) matchups
      if (slot.winner_id || !slot.matchup_id) return slot;
      const aScore = slot.team_a_id ? liveScores[slot.team_a_id] : undefined;
      const bScore = slot.team_b_id ? liveScores[slot.team_b_id] : undefined;
      if (aScore === undefined && bScore === undefined) return slot;
      return {
        ...slot,
        team_a_score: aScore ?? slot.team_a_score,
        team_b_score: bScore ?? slot.team_b_score,
      };
    });
  }, [bracketQuery.data?.slots, liveScores]);

  return {
    data: slots,
    isLoading: bracketQuery.isLoading,
    error: bracketQuery.error,
  };
}

export function useSeedPicks(season: string, round: number | null, poll = false) {
  const { leagueId } = useAppState();
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: queryKeys.seedPicks(leagueId!, Number(season), round ?? undefined),
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
      .channel(`seed-picks-${leagueId}-${season}-${round}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'playoff_seed_picks',
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.seedPicks(leagueId!, Number(season), round ?? undefined) });
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
    // queryClient is a stable singleton — omitting prevents unnecessary channel teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll, leagueId, season, round]);

  return query;
}

/** Returns the current user's pending seed pick for the active round, or null. */
export function usePendingSeedPick(season: string, poll = false) {
  const { leagueId, teamId } = useAppState();

  // Real-time invalidation is handled by useSeedPicks above,
  // so this hook only needs a standard query — no polling needed.
  return useQuery({
    queryKey: queryKeys.pendingSeedPick(leagueId!, teamId!, Number(season)),
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
