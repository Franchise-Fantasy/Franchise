import { useQuery } from '@tanstack/react-query';

import type { Sport } from '@/constants/LeagueDefaults';
import { useOptionalAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';

/**
 * Resolves the sport for the active league. Sport is immutable post-creation,
 * so this query has a generous staleTime.
 *
 * Falls back to `'nba'` while loading or when no league is active so callers
 * never block on it — every consumer should be safe to default to NBA.
 */
export function useActiveLeagueSport(leagueIdOverride?: string | null): Sport {
  // Non-throwing read: a few components render above AppStateProvider
  // (e.g. PushSoftPrompt mounted by AuthProvider). Default to no league
  // so the NBA fallback below kicks in.
  const appState = useOptionalAppState();
  const leagueId = leagueIdOverride ?? appState?.leagueId ?? null;

  const { data } = useQuery({
    queryKey: ['leagueSport', leagueId],
    queryFn: async (): Promise<Sport> => {
      if (!leagueId) return 'nba';
      const { data: row } = await supabase
        .from('leagues')
        .select('sport')
        .eq('id', leagueId)
        .maybeSingle();
      return (row?.sport as Sport) ?? 'nba';
    },
    enabled: !!leagueId,
    staleTime: Infinity,
  });

  return (data ?? 'nba') as Sport;
}
