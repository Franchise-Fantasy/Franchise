import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type {
  NhlArchiveAwards,
  NhlArchiveBracket,
  NhlArchiveStandingsPayload,
  NhlArchiveTeamRun,
} from '@/types/archiveNhlPlayoff';

export interface NhlArchiveSeasonRow {
  season: number;
  champion_franchise_id: string | null;
  champion_tricode: string | null;
  champion_city: string | null;
  champion_name: string | null;
  champion_logo_key: string | null;
  champion_primary_color: string | null;
  champion_secondary_color: string | null;
}

export function useNhlArchiveSeasons() {
  return useQuery({
    queryKey: queryKeys.nhlArchiveSeasons(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nhl_archive_seasons');
      if (error) throw error;
      return (data ?? []) as NhlArchiveSeasonRow[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNhlArchiveBracket(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nhlArchiveBracket(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nhl_archive_bracket', {
        p_season: season as number,
      });
      if (error) throw error;
      return data as unknown as NhlArchiveBracket;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNhlArchiveStandings(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nhlArchiveStandings(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nhl_archive_standings', {
        p_season: season as number,
      });
      if (error) throw error;
      return data as unknown as NhlArchiveStandingsPayload;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNhlArchiveAwards(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nhlArchiveAwards(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nhl_archive_awards', {
        p_season: season as number,
      });
      if (error) throw error;
      return (data ?? {}) as unknown as NhlArchiveAwards;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNhlArchiveTeamRun(
  season: number | null | undefined,
  franchiseId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.nhlArchiveTeamRun(season ?? 0, franchiseId ?? ''),
    enabled: typeof season === 'number' && !!franchiseId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nhl_archive_team_run', {
        p_season: season as number,
        p_franchise_id: franchiseId as string,
      });
      if (error) throw error;
      return data as unknown as NhlArchiveTeamRun;
    },
    staleTime: 5 * 60 * 1000,
  });
}
