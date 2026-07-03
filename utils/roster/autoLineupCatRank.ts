import { PlayerGameLog, PlayerSeasonStats } from '@/types/player';
import { buildCategoryRankMap, LeagueCategory } from '@/utils/scoring/categoryAnalytics';
import { buildWindowedStatRow } from '@/utils/scoring/windowAverages';

/**
 * CAT-league ranking input for the auto-lineup optimizer: picks each player's
 * best-available stat row, composites it over the league's enabled categories,
 * and shifts the scores so the minimum is at least 1 (the optimizer treats 0
 * as "no game today" — a negative z-sum must still outrank a player who isn't
 * playing).
 *
 * Per-player row, in priority order:
 *   1. windowed slice (when a window is active and the log has played games)
 *   2. last season's stats (under-sampled current season)
 *   3. the player's own current-season row
 */
export function buildAutoLineupCatRanks(opts: {
  players: PlayerSeasonStats[];
  leagueCats: LeagueCategory[] | undefined;
  /** Active Lx window size, or null on the Season view. */
  winSize: number | null;
  logsByPlayer: Map<string, PlayerGameLog[]> | undefined;
  /** player_id → player_historical_stats row (previous season). */
  prevSeasonStats: Map<string, PlayerSeasonStats>;
  /** Current-season sample size below which the prev-season row ranks instead. */
  minCurrentSeasonGames: number;
}): Map<string, number> {
  const { players, leagueCats, winSize, logsByPlayer, prevSeasonStats, minCurrentSeasonGames } =
    opts;

  const statRows = players.map((p) => {
    if (winSize != null) {
      const windowed = buildWindowedStatRow(p, logsByPlayer?.get(p.player_id), winSize);
      if (windowed) return windowed;
    }
    return (p.games_played ?? 0) >= minCurrentSeasonGames
      ? p
      : (prevSeasonStats.get(p.player_id) ?? p);
  });

  const rank = buildCategoryRankMap(statRows, leagueCats);
  let minVal = Infinity;
  for (const v of rank.values()) minVal = Math.min(minVal, v);
  const shift = minVal < 1 ? 1 - minVal : 0;
  const shifted = new Map<string, number>();
  // Clamp guards the ≥1 contract against float dust in `v + shift`; only the
  // min player can land a hair under 1, so ordering is unaffected.
  for (const [pid, v] of rank) shifted.set(pid, Math.max(1, v + shift));
  return shifted;
}
