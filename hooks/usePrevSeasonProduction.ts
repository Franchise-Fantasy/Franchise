import { useQuery } from '@tanstack/react-query';

import { getPreviousSeason, type Sport } from '@/constants/LeagueDefaults';
import { inputsDigest, queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { catContributionPerGame } from '@/utils/scoring/dependencyRisk';
import { seasonAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

/** Previous-season season-average rows for the given players. */
async function fetchPrevSeasonRows(sport: Sport, season: string, playerIds: string[]) {
  const { data, error } = await supabase
    .from('player_historical_stats')
    .select('*')
    .eq('sport', sport)
    .eq('season', season)
    .in('player_id', playerIds);
  if (error) throw error;
  return data ?? [];
}

/** Loads previous-season fpts-per-game for every player on the given list,
 *  keyed by player_id. Used as a fallback weight when the current season
 *  hasn't produced enough data to drive analytics (WNBA pre-tipoff is the
 *  motivating case). Mirrors the auto-lineup fallback in `app/(tabs)/roster.tsx`.
 *
 *  Returns an empty map when there are no players, no scoring weights, or
 *  no historical rows — callers should treat this as a transparent fallback. */
export function usePrevSeasonFpts(
  leagueId: string | null | undefined,
  sport: Sport,
  playerIds: string[],
  scoringWeights: ScoringWeight[] | undefined,
) {
  const previousSeason = getPreviousSeason(sport);

  // The cached map only covers the ids it was fetched with, and its values are
  // computed with the scoring weights of that fetch — so BOTH have to be part
  // of the cache key. Callers pass different player sets for the same league
  // (one team's roster vs. every player in it), and a narrower cached map would
  // otherwise satisfy a league-wide read: the analytics preview card would rank
  // every OTHER team with no prev-season fallback, so its numbers changed
  // between app opens depending on which screen loaded first.
  const digest = inputsDigest([
    ...playerIds,
    ...(scoringWeights ?? []).map((w) => `${w.stat_name}=${w.point_value}`),
  ]);

  return useQuery<Map<string, number>>({
    queryKey: queryKeys.prevSeasonFpts(leagueId ?? '', previousSeason, digest),
    queryFn: async () => {
      const map = new Map<string, number>();
      if (playerIds.length === 0 || !scoringWeights || scoringWeights.length === 0) {
        return map;
      }
      const rows = await fetchPrevSeasonRows(sport, previousSeason, playerIds);
      for (const row of rows) {
        const pid = (row as { player_id?: string }).player_id;
        if (!pid) continue;
        const fpts = seasonAvgRowToFpts(row as Record<string, unknown>, scoringWeights, sport);
        if (fpts > 0) map.set(pid, fpts);
      }
      return map;
    },
    enabled: !!leagueId && playerIds.length > 0 && (scoringWeights?.length ?? 0) > 0,
    staleTime: 1000 * 60 * 30,
  });
}

/** Raw previous-season rows for the given players, keyed by player_id.
 *
 *  The two hooks either side of this one collapse each row to a single number
 *  (fpts, cat contribution). Surfaces that render a whole stat line — the drop
 *  picker's MIN / shooting splits / STL / BLK / TOV grid — need the row itself,
 *  so this returns it untouched and lets the caller merge it via
 *  `resolveStatBasis`. Not league-scoped: nothing here depends on a league's
 *  scoring settings. */
export function usePrevSeasonRows(sport: Sport, playerIds: string[]) {
  const previousSeason = getPreviousSeason(sport);
  const digest = inputsDigest(playerIds);

  return useQuery<Map<string, Record<string, unknown>>>({
    queryKey: queryKeys.prevSeasonRows(sport, previousSeason, digest),
    queryFn: async () => {
      const map = new Map<string, Record<string, unknown>>();
      if (playerIds.length === 0) return map;
      const rows = await fetchPrevSeasonRows(sport, previousSeason, playerIds);
      for (const row of rows) {
        const pid = (row as { player_id?: string }).player_id;
        if (pid) map.set(pid, row as Record<string, unknown>);
      }
      return map;
    },
    enabled: playerIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });
}

/** Categories twin of `usePrevSeasonFpts`: previous-season composite cat
 *  contribution per game, keyed by player_id. Fantasy points aren't a
 *  categories league's currency, so its analytics need this shape instead to
 *  survive the pre-tipoff window. Same fetch, different scoring lens. */
export function usePrevSeasonCatProduction(
  leagueId: string | null | undefined,
  sport: Sport,
  playerIds: string[],
) {
  const previousSeason = getPreviousSeason(sport);
  const digest = inputsDigest(playerIds);

  return useQuery<Map<string, number>>({
    queryKey: queryKeys.prevSeasonCatProduction(leagueId ?? '', previousSeason, digest),
    queryFn: async () => {
      const map = new Map<string, number>();
      if (playerIds.length === 0) return map;
      const rows = await fetchPrevSeasonRows(sport, previousSeason, playerIds);
      for (const row of rows) {
        const r = row as unknown as PlayerSeasonStats;
        const value = catContributionPerGame(r);
        if (value > 0) map.set(r.player_id, value);
      }
      return map;
    },
    enabled: !!leagueId && playerIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });
}
