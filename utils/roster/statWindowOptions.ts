import type { GameWindow } from '@/utils/scoring/fantasyPoints';

/** The roster pages layer two non-window choices on top of the historical stat
 *  windows: "Proj" (a projection) and "Prev" (last season's averages). Neither
 *  is a `GameWindow` — they slice nothing from the current game log — so they
 *  live here rather than in the analytics window type. */
export type RosterStatMode = GameWindow | 'proj' | 'prev';

export interface StatWindowInputs {
  /** Most current-season games any player on the roster has played — gates the
   *  Lx options so we never offer an "L15" nobody can fill. */
  maxRosterGames: number;
  /** The current season hasn't tipped off yet, so `player_season_stats` is
   *  empty for the whole roster. */
  isPreSeason: boolean;
  /** Category leagues have no fantasy points, so neither projections nor
   *  prev-season fpts mean anything to them. */
  isCategories: boolean;
  hasProjections: boolean;
  hasPrevSeason: boolean;
}

/**
 * Which stat windows are worth offering, in display order.
 *
 * Pre-tipoff "Season" is dropped rather than offered as a dead option: the
 * matview is scoped to `season_config.is_current`, so every player sits at 0
 * games and a season average would render blank for the entire roster.
 */
export function buildWindowOptions({
  maxRosterGames,
  isPreSeason,
  isCategories,
  hasProjections,
  hasPrevSeason,
}: StatWindowInputs): readonly RosterStatMode[] {
  const out: RosterStatMode[] = [];
  if (maxRosterGames >= 5) out.push('L5');
  if (maxRosterGames >= 10) out.push('L10');
  if (maxRosterGames >= 15) out.push('L15');
  if (!isPreSeason) out.push('season');
  // Forward-/historical-looking modes sit below the windows (points leagues):
  // Proj under Season, Prev under Proj.
  if (!isCategories && hasProjections) out.push('proj');
  if (!isCategories && hasPrevSeason) out.push('prev');
  // Never leave the picker with nothing selectable — a category league
  // pre-tipoff has neither projections nor prev-season fpts.
  if (out.length === 0) out.push('season');
  return out;
}

/** Where the picker lands when the user hasn't chosen: the season average
 *  normally, the projection pre-tipoff (or whatever else survived the filter). */
export function defaultStatWindow(
  options: readonly RosterStatMode[],
  isPreSeason: boolean,
): RosterStatMode {
  if (!isPreSeason) return 'season';
  return options.includes('proj') ? 'proj' : options[0];
}

/** The effective selection. A pick that's no longer on offer — queries still
 *  resolving, a season rollover — falls back to the default rather than
 *  leaving the picker pointed at a hidden option. */
export function resolveStatWindow(
  picked: RosterStatMode | null,
  options: readonly RosterStatMode[],
  isPreSeason: boolean,
): RosterStatMode {
  if (picked && options.includes(picked)) return picked;
  return defaultStatWindow(options, isPreSeason);
}
