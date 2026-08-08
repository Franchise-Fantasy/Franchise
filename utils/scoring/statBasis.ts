import type { ProjectionRow } from '@/hooks/usePlayerProjections';
import type { PlayerSeasonStats } from '@/types/player';
import { preferProjection } from '@/utils/draft/draftRanking';
import {
  mergeBasketballHistoricalRow,
  mergeNflHistoricalRow,
  mergeProjectionRow,
} from '@/utils/freeAgent/freeAgentStats';

/**
 * Which stat line a player-pool row should actually display, for surfaces that
 * show one number per player rather than a user-selectable window.
 *
 * `player_season_stats` is scoped to `season_config.is_current`, so between the
 * season_config flip and tipoff EVERY row reads `games_played=0, avg_*=NULL`.
 * Rendering that raw gives a wall of dashes, and — worse — a 0 that flows into
 * anything scoring the row (`calculateAvgFantasyPoints` short-circuits to 0 at
 * zero games), which is how the trade builder came to value every player at
 * 0.0 FPTS against a draft pick's real `estimatePickFpts`.
 *
 * The fallback chain is the one the draft board and the autodraft bot already
 * walk (`effectiveDraftPts`): real current-season line once the sample is thick
 * enough, else the season projection, else last season, else nothing. Sharing
 * `preferProjection`'s threshold is what keeps a player reading the same on the
 * wire, the board and the pickers.
 */
export type StatBasis = 'season' | 'projected' | 'prev';

export interface ResolvedStatLine {
  /** The row to read stats off. Identity columns are always the player's own;
   *  only the stat columns are swapped. */
  row: PlayerSeasonStats;
  basis: StatBasis;
  /** False when nothing is available — no current sample, no projection, no
   *  prior season. Callers render an em-dash rather than a substitute 0. */
  hasStats: boolean;
  /** Caption naming a non-current basis ("PROJ" / "'25-'26"), null when `row`
   *  is the real current season. A borrowed number must always be labelled. */
  label: string | null;
}

interface ResolveInput {
  player: PlayerSeasonStats;
  projection: ProjectionRow | undefined;
  historical: Record<string, unknown> | undefined;
  sport?: string | null;
  /** Compact previous-season label from `formatSeasonShort`, e.g. "'25-'26". */
  prevSeasonLabel: string;
}

export function resolveStatBasis({
  player,
  projection,
  historical,
  sport,
  prevSeasonLabel,
}: ResolveInput): ResolvedStatLine {
  if (!preferProjection(player.games_played)) {
    return { row: player, basis: 'season', hasStats: player.games_played > 0, label: null };
  }

  if (projection) {
    return {
      row: mergeProjectionRow(player, projection),
      basis: 'projected',
      hasStats: true,
      label: 'PROJ',
    };
  }

  // NFL has no projections engine in v1, and a rookie has no prior season, so
  // both land here. A historical row with no games is as empty as the matview
  // row it would replace — leave the player showing nothing instead.
  if (historical && Number(historical.games_played ?? 0) > 0) {
    return {
      row:
        sport === 'nfl'
          ? mergeNflHistoricalRow(player, historical)
          : mergeBasketballHistoricalRow(player, historical),
      basis: 'prev',
      hasStats: true,
      label: prevSeasonLabel,
    };
  }

  // Nothing to fall back to. A thin sample still beats no sample, so a
  // just-called-up player keeps their own few games rather than dropping to an
  // em-dash; only a genuinely statless row shows nothing.
  return { row: player, basis: 'season', hasStats: player.games_played > 0, label: null };
}

/**
 * Spoken qualifier for a borrowed stat line, e.g. "projected 41.2 fantasy
 * points". A screen reader never sees the visual PROJ / season caption beside
 * the number, so the basis has to live in the sentence itself.
 */
export function spokenStatBasis(basis: StatBasis): string {
  if (basis === 'projected') return 'projected ';
  if (basis === 'prev') return 'last season ';
  return '';
}

/**
 * Games played, but only when the number means what the column header says.
 * A projected row carries `projected_games` in `games_played` (that's what
 * makes projected FPTS/G divide out), and projections speak per-game only —
 * surfacing that count would put an engine-internal availability estimate in
 * front of users. Null renders as an em-dash.
 */
export function displayGamesPlayed(resolved: ResolvedStatLine): number | null {
  if (resolved.basis === 'projected' || !resolved.hasStats) return null;
  return resolved.row.games_played;
}
