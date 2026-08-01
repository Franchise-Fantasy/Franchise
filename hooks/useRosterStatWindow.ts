import { useMemo, useState } from 'react';

import {
  formatProjFpts,
  prevFptsToContext,
  projectionToContext,
  type SeasonAverages,
} from '@/components/roster/rosterData';
import {
  formatSeasonShort,
  getPreviousSeason,
  isSeasonStarted,
  type Sport,
} from '@/constants/LeagueDefaults';
import { usePlayerProjections } from '@/hooks/usePlayerProjections';
import { usePrevSeasonFpts } from '@/hooks/usePrevSeasonProduction';
import { useRosterGameLogs } from '@/hooks/useRosterGameLogs';
import type { ScoringWeight } from '@/types/player';
import {
  buildWindowOptions,
  resolveStatWindow,
  type RosterStatMode,
} from '@/utils/roster/statWindowOptions';
import { gameWindowSize } from '@/utils/scoring/fantasyPoints';

/** Minimal shape the window logic needs off a roster row. */
interface WindowRosterPlayer {
  player_id: string;
  games_played?: number | null;
}

interface Params {
  leagueId: string | null | undefined;
  sport: Sport;
  /** The team's roster rows — supplies both the player id list and the
   *  current-season sample size that gates the Lx options. */
  rosterPlayers: readonly WindowRosterPlayer[] | undefined;
  scoringWeights: ScoringWeight[] | undefined;
  isCategories: boolean;
  /** Today in the sport's own timezone (`getSportToday`/`useSportToday`). */
  today: string;
}

/**
 * Owns the roster pages' forward-facing stat window: which options the picker
 * offers, which one is selected, and the data each one reads from. Shared by
 * `app/(tabs)/roster.tsx` and its read-only mirror `app/team-roster/[id].tsx`
 * so the two can't drift.
 *
 * The pre-tipoff case is the reason this is more than a `useState`. Between
 * seasons `player_season_stats` is empty for everyone (the matview is scoped to
 * `season_config.is_current`), so "Season" and the Lx windows have nothing to
 * render. Rather than offer dead options — or silently pass last season's
 * average off as this season's, which is what the roster used to do — the
 * picker drops them and defaults to "Proj", fed by the season-long projection
 * horizon instead of the next-game one (there is no next game yet).
 */
export function useRosterStatWindow({
  leagueId,
  sport,
  rosterPlayers,
  scoringWeights,
  isCategories,
  today,
}: Params) {
  // Only the user's explicit pick is state; the effective selection is derived
  // below. Storing the selection outright would need an effect to re-sync it as
  // the queries land, and that effect would race: with the projection map
  // arriving after the prev-season map, an untouched picker would settle on
  // "Prev" simply because it was briefly the only option.
  const [pickedWindow, setPickedWindow] = useState<RosterStatMode | null>(null);

  const isPreSeason = !isSeasonStarted(sport, today);
  const playerIds = useMemo(
    () => rosterPlayers?.map((p) => p.player_id) ?? [],
    [rosterPlayers],
  );

  // Previous-season fpts/G (points leagues) — powers the "Prev" window option:
  // last season's average in the context slot. Cheap, cached; disabled for
  // categories (no fpts) by passing an empty id list.
  const { data: prevSeasonFpts } = usePrevSeasonFpts(
    leagueId,
    sport,
    isCategories ? [] : playerIds,
    scoringWeights,
  );
  // Compact label for the "Prev" window — the previous season itself ("'25" /
  // "'24-'25") rather than the word "Prev".
  const prevSeasonLabel = formatSeasonShort(getPreviousSeason(sport), sport);

  // Next-game projections stay unconditional — they also feed the inline chip
  // beside an upcoming game, which exhibition games can trigger before the
  // regular season tips off. The season-long horizon is fetched only when it's
  // needed, because pre-tipoff `next_game` is empty (nothing is scheduled) and
  // that is exactly when the roster lost its "Proj" option — leaving last
  // season's average as the only number, silently labelled as this season's.
  const { data: nextGameProjections } = usePlayerProjections(
    sport,
    'next_game',
    !isCategories,
  );
  const { data: seasonProjections } = usePlayerProjections(
    sport,
    'season',
    !isCategories && isPreSeason,
  );
  const projectionMap = isPreSeason ? seasonProjections : nextGameProjections;

  // Adaptive window options — only show Lx when at least one rostered player
  // has that many games played. Mirrors the rule in PointsStrengthAnalytics.
  const maxRosterGames = useMemo(() => {
    let max = 0;
    for (const p of rosterPlayers ?? []) {
      const g = p.games_played ?? 0;
      if (g > max) max = g;
    }
    return max;
  }, [rosterPlayers]);

  const availableWindows = useMemo(
    () =>
      buildWindowOptions({
        maxRosterGames,
        isPreSeason,
        isCategories,
        hasProjections: (projectionMap?.size ?? 0) > 0,
        hasPrevSeason: (prevSeasonFpts?.size ?? 0) > 0,
      }),
    [maxRosterGames, isPreSeason, isCategories, projectionMap, prevSeasonFpts],
  );

  const windowSel = resolveStatWindow(pickedWindow, availableWindows, isPreSeason);

  // "Proj"/"Prev" aren't game-log windows — they slice nothing, so winSize
  // stays null and the row context reads from projections / last season instead.
  const isProjMode = windowSel === 'proj';
  const isPrevMode = windowSel === 'prev';
  const winSize =
    windowSel === 'proj' || windowSel === 'prev' ? null : gameWindowSize(windowSel);
  const { data: rosterLogsByPlayer } = useRosterGameLogs(
    winSize != null ? playerIds : [],
  );

  // Context-slot readers, so neither page has to know which projection horizon
  // it's looking at. "Proj" renders whichever map is live for the current
  // phase; the inline upcoming-game chip always wants the next-game one.
  const projContextFor = (playerId: string): SeasonAverages | null =>
    projectionToContext(projectionMap?.get(playerId), scoringWeights, sport);
  const prevContextFor = (playerId: string): SeasonAverages | null =>
    prevFptsToContext(prevSeasonFpts?.get(playerId));
  const upcomingProjFor = (playerId: string): string | null =>
    formatProjFpts(nextGameProjections?.get(playerId), scoringWeights, isCategories, sport);

  return {
    windowSel,
    onWindowChange: setPickedWindow,
    availableWindows,
    prevSeasonLabel,
    isPreSeason,
    isProjMode,
    isPrevMode,
    winSize,
    rosterLogsByPlayer,
    prevSeasonFpts,
    projectionMap,
    projContextFor,
    prevContextFor,
    upcomingProjFor,
  };
}
