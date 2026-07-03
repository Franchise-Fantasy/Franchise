import { useQuery } from '@tanstack/react-query';

import {
  getCurrentSeason,
  parseSeasonStartYear,
  rookieDraftStartOffset,
  Sport,
} from '@/constants/LeagueDefaults';
import { useOptionalAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';

/**
 * The nearest draft class still open for the active league's rookie draft,
 * as a calendar year (e.g. 2026).
 *
 * Mirrors the season/offseason_step window logic in useDraftHub: once
 * `advance-season` flips `league.season` into the new year, the incoming
 * class must stay "next" (offset 0) until THIS league's own rookie draft
 * completes — not just because the sport-wide season rolled over. Without
 * this, a global `season_config` flip makes the just-ended class vanish
 * from the Prospects tab for every league that hasn't drafted it yet.
 */
export function useNextRookieDraftYear(sport: Sport): number {
  const appState = useOptionalAppState();
  const leagueId = appState?.leagueId ?? null;

  const { data } = useQuery({
    queryKey: ['leagueOffseasonState', leagueId],
    queryFn: async () => {
      const { data: row } = await supabase
        .from('leagues')
        .select('season, offseason_step')
        .eq('id', leagueId!)
        .maybeSingle();
      return row;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60,
  });

  const startOffset = rookieDraftStartOffset(data?.offseason_step ?? null);
  const currentStartYear = parseSeasonStartYear(data?.season ?? getCurrentSeason(sport));

  return currentStartYear + startOffset;
}
