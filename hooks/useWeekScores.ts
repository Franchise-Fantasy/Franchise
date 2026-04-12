import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

interface UseWeekScoresOptions {
  leagueId: string | null;
  scheduleId: string | null;
  /** Whether the week is currently live (today falls within the week) */
  weekIsLive: boolean;
}

async function fetchWeekScores(
  scheduleId: string,
): Promise<Record<string, number>> {
  // Read from the week_scores table (populated by the cron edge function)
  const { data, error } = await supabase
    .from('week_scores')
    .select('team_id, score')
    .eq('schedule_id', scheduleId);

  if (error) throw error;

  const scores: Record<string, number> = {};
  for (const row of data ?? []) {
    scores[row.team_id] = Number(row.score);
  }
  return scores;
}

async function triggerScoreCompute(
  leagueId: string,
  scheduleId: string,
): Promise<Record<string, number>> {
  // For non-live weeks with no cached scores, trigger the edge function once
  // to compute and persist scores, then return them
  const { data, error } = await supabase.functions.invoke('get-week-scores', {
    body: { league_id: leagueId, schedule_id: scheduleId },
  });
  if (error) throw error;
  return data?.scores ?? {};
}

/**
 * Fetches week scores from the week_scores table.
 * For live weeks, the cron edge function keeps this table updated every ~30s.
 * For non-live weeks, triggers a one-time compute if no cached scores exist.
 * Subscribes to realtime changes on week_scores for instant UI updates.
 */
export function useWeekScores({ leagueId, scheduleId, weekIsLive }: UseWeekScoresOptions) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: queryKeys.weekScores(leagueId!, scheduleId!),
    queryFn: async () => {
      if (!scheduleId || !leagueId) return {};

      // Try reading from the table first
      const scores = await fetchWeekScores(scheduleId);

      // If no scores cached and this isn't a live week, trigger a one-time compute
      if (Object.keys(scores).length === 0 && !weekIsLive) {
        return triggerScoreCompute(leagueId, scheduleId);
      }

      return scores;
    },
    enabled: !!leagueId && !!scheduleId,
    staleTime: weekIsLive ? 1000 * 60 * 5 : 1000 * 60 * 30, // Realtime handles live updates, so staleTime can be longer
  });

  // Subscribe to week_scores table changes for this schedule
  useEffect(() => {
    if (!scheduleId) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    const channel = supabase
      .channel(`week-scores-${scheduleId}-${Date.now()}`)
      .on(
        'broadcast',
        { event: 'score_update' },
        (payload) => {
          // Broadcast delivers the full score map for this schedule in one message,
          // avoiding per-row WAL overhead from postgres_changes.
          const scores = payload.payload?.scores as Record<string, number> | undefined;
          if (scores) {
            queryClient.setQueryData(
              queryKeys.weekScores(leagueId!, scheduleId!),
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
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [scheduleId, leagueId, queryClient]);

  return query;
}
