import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

export interface Announcement {
  id: string;
  league_id: string;
  team_id: string;
  content: string;
  created_at: string;
  teams?: { name: string };
}

export function useLatestAnnouncement(leagueId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`announcements_${leagueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'commissioner_announcements',
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          // Update latestAnnouncement directly from payload (avoids an extra fetch)
          const row = payload.new as Announcement;
          if (row) {
            queryClient.setQueryData(queryKeys.latestAnnouncement(leagueId!), row);
          }
          // The full list needs a refetch for the team name join
          queryClient.invalidateQueries({ queryKey: queryKeys.announcements(leagueId!) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);

  return useQuery<Announcement | null>({
    queryKey: queryKeys.latestAnnouncement(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissioner_announcements')
        .select('id, league_id, team_id, content, created_at')
        .eq('league_id', leagueId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useAnnouncements(leagueId: string | null) {
  return useQuery<Announcement[]>({
    queryKey: queryKeys.announcements(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissioner_announcements')
        .select('id, league_id, team_id, content, created_at, teams(name)')
        .eq('league_id', leagueId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        ...row,
        teams: Array.isArray(row.teams) ? row.teams[0] ?? null : row.teams,
      })) as Announcement[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}
