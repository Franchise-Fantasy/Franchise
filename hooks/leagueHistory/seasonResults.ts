import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { PLAYOFF_RESULT } from '@/types/playoff';

import type { ChampionEntry, TeamSeasonRow } from './types';

// Data source: team_seasons (one row per team per completed season).

export function useChampions(leagueId: string | null) {
  return useQuery<ChampionEntry[]>({
    queryKey: queryKeys.leagueChampions(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seasons')
        .select('season, playoff_result, team:teams!team_seasons_team_id_fkey(id, name)')
        .eq('league_id', leagueId!)
        .in('playoff_result', [PLAYOFF_RESULT.CHAMPION, PLAYOFF_RESULT.RUNNER_UP])
        .order('season', { ascending: true })
        .limit(200);
      if (error) throw error;

      const byS = new Map<string, ChampionEntry>();
      for (const row of data ?? []) {
        if (!byS.has(row.season)) {
          byS.set(row.season, { season: row.season, champion: null, runnerUp: null });
        }
        const entry = byS.get(row.season)!;
        const team = Array.isArray(row.team) ? row.team[0] ?? null : row.team;
        if (row.playoff_result === PLAYOFF_RESULT.CHAMPION) entry.champion = team;
        else entry.runnerUp = team;
      }
      return [...byS.values()];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

export function useSeasonStandings(leagueId: string | null) {
  return useQuery<TeamSeasonRow[]>({
    queryKey: queryKeys.seasonStandings(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seasons')
        .select('id, team_id, season, wins, losses, ties, points_for, points_against, final_standing, playoff_result, team:teams!team_seasons_team_id_fkey(id, name, tricode, logo_key)')
        .eq('league_id', leagueId!)
        .order('season', { ascending: false })
        .order('final_standing', { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as TeamSeasonRow[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
