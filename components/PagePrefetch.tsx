import { useQuery } from '@tanstack/react-query';

import type { Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useDraftHub } from '@/hooks/useDraftHub';
import {
  useAllTimeRecords,
  useChampions,
  useSeasonStandings,
} from '@/hooks/useLeagueHistory';
import { useTeamNews } from '@/hooks/useTeamNews';
import { useTransactions } from '@/hooks/useTransactions';
import { supabase } from '@/lib/supabase';

interface Props {
  leagueId: string;
  teamId: string | null;
  sport: Sport | undefined;
}

/**
 * Warms React Query cache for pages that are flashy on first open
 * (Activity, News, Draft Hub, League History, Scoreboard). Mounted on
 * the home screen so by the time the user navigates in, the data is
 * already cached. Renders nothing.
 */
export function PagePrefetch({ leagueId, teamId, sport }: Props) {
  // Activity
  useTransactions();

  // Draft Hub
  useDraftHub(leagueId);

  // League History (TrophyCase + AllTimeRecords + default Standings segment)
  useChampions(leagueId);
  useAllTimeRecords(leagueId);
  useSeasonStandings(leagueId);

  // News — default filter is "team" which needs roster IDs first.
  const { data: rosterIds = [] } = useQuery<string[]>({
    queryKey: queryKeys.newsRosterIds(leagueId, teamId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.player_id);
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });
  useTeamNews(rosterIds, 'filtered', sport);

  // Scoreboard — week rail + team records.
  useQuery({
    queryKey: queryKeys.leagueSchedule(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_schedule')
        .select('id, week_number, start_date, end_date, is_playoff')
        .eq('league_id', leagueId)
        .order('week_number', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });
  useQuery({
    queryKey: queryKeys.leagueTeamsRecord(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, logo_key, wins, losses, ties')
        .eq('league_id', leagueId);
      if (error) throw error;
      const map: Record<string, { id: string; name: string; logo_key: string | null; wins: number; losses: number; ties: number }> = {};
      for (const t of data ?? []) {
        map[t.id] = {
          id: t.id,
          name: t.name,
          logo_key: t.logo_key ?? null,
          wins: t.wins ?? 0,
          losses: t.losses ?? 0,
          ties: t.ties ?? 0,
        };
      }
      return map;
    },
    staleTime: 1000 * 60 * 10,
  });

  return null;
}

/**
 * Wrapper that pulls leagueId/teamId off AppState and only mounts
 * the prefetcher once both are known. Lets callers drop in
 * `<PagePrefetch />` without threading props.
 */
export function PagePrefetchAuto({ sport }: { sport: Sport | undefined }) {
  const { leagueId, teamId } = useAppState();
  if (!leagueId) return null;
  return <PagePrefetch leagueId={leagueId} teamId={teamId} sport={sport} />;
}
