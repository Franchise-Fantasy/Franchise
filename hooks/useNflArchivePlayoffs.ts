import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type {
  NflArchiveAwards,
  NflArchiveBracket,
  NflArchiveStandingsPayload,
  NflArchiveTeamRun,
} from '@/types/archiveNflPlayoff';

export interface NflArchiveSeasonRow {
  season: number;
  champion_franchise_id: string | null;
  champion_tricode: string | null;
  champion_city: string | null;
  champion_name: string | null;
  champion_logo_key: string | null;
  champion_primary_color: string | null;
  champion_secondary_color: string | null;
}

export function useNflArchiveSeasons() {
  return useQuery({
    queryKey: queryKeys.nflArchiveSeasons(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nfl_archive_seasons');
      if (error) throw error;
      return (data ?? []) as NflArchiveSeasonRow[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNflArchiveBracket(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nflArchiveBracket(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nfl_archive_bracket', {
        p_season: season as number,
      });
      if (error) throw error;
      return data as unknown as NflArchiveBracket;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNflArchiveStandings(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nflArchiveStandings(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nfl_archive_standings', {
        p_season: season as number,
      });
      if (error) throw error;
      return data as unknown as NflArchiveStandingsPayload;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNflArchiveAwards(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.nflArchiveAwards(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nfl_archive_awards', {
        p_season: season as number,
      });
      if (error) throw error;
      return (data ?? {}) as unknown as NflArchiveAwards;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useNflArchiveTeamRun(
  season: number | null | undefined,
  franchiseId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.nflArchiveTeamRun(season ?? 0, franchiseId ?? ''),
    enabled: typeof season === 'number' && !!franchiseId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nfl_archive_team_run', {
        p_season: season as number,
        p_franchise_id: franchiseId as string,
      });
      if (error) throw error;
      return data as unknown as NflArchiveTeamRun;
    },
    staleTime: 5 * 60 * 1000,
  });
}
