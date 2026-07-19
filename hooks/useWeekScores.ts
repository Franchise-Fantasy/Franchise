import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { subscribeScoreTopic } from '@/lib/scoreTopics';
import { supabase } from '@/lib/supabase';

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

  // Subscribe to week_scores updates for this schedule via the ref-counted
  // topic manager — several screens listen to the same schedule at once, and
  // a per-screen channel would be torn down for ALL of them by whichever
  // screen unmounted first (shared deterministic topic).
  useEffect(() => {
    if (!scheduleId) return;
    return subscribeScoreTopic(scheduleId, (row) => {
      queryClient.setQueryData(
        queryKeys.weekScores(leagueId!, scheduleId!),
        (old: Record<string, number> | undefined) => ({
          ...old,
          [row.team_id!]: Number(row.score),
        }),
      );
    });
    // queryClient is a stable singleton — omitting prevents unnecessary channel teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId, leagueId]);

  return query;
}
