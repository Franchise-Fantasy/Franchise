import { useQuery } from '@tanstack/react-query';

import {
  getCurrentSeason,
  getSeasonStart,
  parseSeasonStartYear,
  rookieDraftStartOffset,
  Sport,
} from '@/constants/LeagueDefaults';
import { useOptionalAppState } from '@/context/AppStateProvider';
import { supabase } from '@/lib/supabase';
import { getSportToday } from '@/utils/leagueTime';

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

  const season = data?.season ?? getCurrentSeason(sport);
  const offseasonStep = data?.offseason_step ?? null;
  const currentStartYear = parseSeasonStartYear(season);

  // The "+1 = next year's class" offset assumes `league.season` is the season
  // being PLAYED right now. But season_config (and `advance-season`) flip
  // `league.season` to the upcoming season months before it tips off — so in
  // the pre-season window that season IS effectively "next year" already, and
  // adding +1 overshoots to a class with no scouting data yet (empty Prospects
  // tab). While the season hasn't started AND the league isn't mid-rookie-draft
  // (offseason_step === null — the only case rookieDraftStartOffset returns +1
  // for), hold the offset at 0 so the tab lands on the incoming class. A live
  // offseason_step already resolves correctly, and this deliberately diverges
  // from useDraftHub's mechanical pick-window offset, which must stay keyed on
  // offseason_step so lottery-seeded picks never disappear.
  const seasonStart = getSeasonStart(sport, season);
  const seasonStarted = !seasonStart || getSportToday(sport) >= seasonStart;
  const startOffset = seasonStarted || offseasonStep != null
    ? rookieDraftStartOffset(offseasonStep)
    : 0;

  return currentStartYear + startOffset;
}
