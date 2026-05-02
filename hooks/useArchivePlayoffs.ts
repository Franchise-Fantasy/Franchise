import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type {
  ArchiveAwards,
  ArchiveBracket,
  ArchiveStandingsPayload,
  ArchiveTeamRun,
} from '@/types/archivePlayoff';

export interface ArchiveSeasonRow {
  season: number;
  champion_franchise_id: string | null;
  champion_tricode: string | null;
  champion_city: string | null;
  champion_name: string | null;
  champion_logo_key: string | null;
  champion_primary_color: string | null;
  champion_secondary_color: string | null;
}

export function useArchiveSeasons() {
  return useQuery({
    queryKey: queryKeys.archiveSeasons(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pro_archive_seasons');
      if (error) throw error;
      return (data ?? []) as ArchiveSeasonRow[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchiveBracket(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.archiveBracket(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pro_archive_bracket', {
        p_season: season as number,
      });
      if (error) throw error;
      return data as unknown as ArchiveBracket;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchiveStandings(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.archiveStandings(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pro_archive_standings', {
        p_season: season as number,
      });
      if (error) throw error;
      return data as unknown as ArchiveStandingsPayload;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchiveAwards(season: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.archiveAwards(season ?? 0),
    enabled: typeof season === 'number',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pro_archive_awards', {
        p_season: season as number,
      });
      if (error) throw error;
      return (data ?? {}) as unknown as ArchiveAwards;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchiveTeamRun(
  season: number | null | undefined,
  franchiseId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.archiveTeamRun(season ?? 0, franchiseId ?? ''),
    enabled: typeof season === 'number' && !!franchiseId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pro_archive_team_run', {
        p_season: season as number,
        p_franchise_id: franchiseId as string,
      });
      if (error) throw error;
      return data as unknown as ArchiveTeamRun;
    },
    staleTime: 5 * 60 * 1000,
  });
}
