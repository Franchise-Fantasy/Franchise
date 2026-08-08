import { useCallback, useMemo } from 'react';

import { formatSeasonShort, getPreviousSeason, type Sport } from '@/constants/LeagueDefaults';
import { usePlayerProjections } from '@/hooks/usePlayerProjections';
import { usePrevSeasonRows } from '@/hooks/usePrevSeasonProduction';
import type { PlayerSeasonStats } from '@/types/player';
import { preferProjection } from '@/utils/draft/draftRanking';
import { resolveStatBasis, type ResolvedStatLine } from '@/utils/scoring/statBasis';

/** Minimal shape the fallback decision needs off a pool row. */
interface StatBasisPlayer {
  player_id: string;
  games_played: number;
}

/**
 * Resolves the stat line each player in a small, fixed pool should display,
 * falling back to a season projection and then last season when the current
 * sample is too thin to speak for itself. See `resolveStatBasis` for the why.
 *
 * Built for the roster-sized pickers (drop picker, trade picker), where the
 * player set is one team's roster — small enough to fetch prior-season rows by
 * id. The free-agent wire and draft board run the same chain over the whole
 * sport pool with their own bulk queries and a user-facing range picker; this
 * is the version for surfaces that just need one honest number per row.
 */
export function usePlayerStatBasis(
  sport: Sport,
  players: readonly StatBasisPlayer[] | undefined,
) {
  // Only thin-sample players need a fallback, and only they need to be in the
  // prior-season fetch. Pre-tipoff that's the whole roster (every avg_* is
  // NULL); mid-season it's just recent call-ups.
  const thinIds = useMemo(
    () =>
      (players ?? [])
        .filter((p) => preferProjection(p.games_played))
        .map((p) => p.player_id),
    [players],
  );
  const needsFallback = thinIds.length > 0;

  // NFL has no projections engine in v1 — skip the query rather than fetch an
  // empty map, and let last season carry those rows.
  const { data: projections } = usePlayerProjections(
    sport,
    'season',
    needsFallback && sport !== 'nfl',
  );
  const { data: prevRows } = usePrevSeasonRows(sport, needsFallback ? thinIds : []);

  const prevSeasonLabel = formatSeasonShort(getPreviousSeason(sport), sport);

  const resolve = useCallback(
    (player: PlayerSeasonStats): ResolvedStatLine =>
      resolveStatBasis({
        player,
        projection: projections?.get(player.player_id),
        historical: prevRows?.get(player.player_id),
        sport,
        prevSeasonLabel,
      }),
    [projections, prevRows, sport, prevSeasonLabel],
  );

  return { resolve };
}
