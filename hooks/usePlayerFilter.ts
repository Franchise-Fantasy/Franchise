import { useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentSeason, parseSeasonStartYear } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { getEligiblePositions } from '@/utils/roster/rosterSlots';
import { calculateAvgFantasyPoints, type GameWindow } from '@/utils/scoring/fantasyPoints';

export type SortKey = 'FPTS' | 'PPG' | 'RPG' | 'APG' | 'SPG' | 'BPG' | 'MPG' | 'FG%' | 'FT%' | 'TO';
// Game-based windows (L5/L10/L15), not day-based — the same `GameWindow` the
// roster pages, Insights card, and analytics use, plus a `lastSeason` view.
// Day windows biased comparisons because schedule density varies (a team with
// 12 games in 14 days vs. one with 8 isn't apples-to-apples). See GameWindow.
export type TimeRange = GameWindow | 'lastSeason';

/** Injury-status visibility filter */
export type InjuryFilter = 'all' | 'healthy' | 'injured';

/** Statuses considered "out / unlikely to play" */
const OUT_STATUSES = new Set(['OUT', 'SUSP', 'DOUBT', 'QUES']);

const SORT_FIELD: Record<string, keyof PlayerSeasonStats> = {
  PPG: 'avg_pts',
  RPG: 'avg_reb',
  APG: 'avg_ast',
  SPG: 'avg_stl',
  BPG: 'avg_blk',
  MPG: 'avg_min',
  TO: 'avg_tov',
};

// FG% and FT% are computed from makes/attempts, not stored directly
function getComputedSort(p: PlayerSeasonStats, key: SortKey): number {
  if (key === 'FG%') return p.avg_fga > 0 ? p.avg_fgm / p.avg_fga : 0;
  if (key === 'FT%') return p.avg_fta > 0 ? p.avg_ftm / p.avg_fta : 0;
  return 0;
}

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'] as const;
const WNBA_FILTER_POSITIONS = ['All', 'G', 'F', 'C'] as const;
const NFL_FILTER_POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
export type PositionFilter = (typeof POSITIONS)[number];
export { POSITIONS };

/** Filter chip list for the player browser. WNBA leagues hide the
 *  PG/SG/SF/PF chips since players are reported as bare G/F/C; NFL uses its
 *  disjoint position set. NHL/MLB fall back to NBA chips today — they don't
 *  ship a player browser yet. */
export function getPositionFilters(sport: string): readonly string[] {
  if (sport === 'wnba') return WNBA_FILTER_POSITIONS;
  if (sport === 'nfl') return NFL_FILTER_POSITIONS;
  return POSITIONS;
}

// Which base positions each group filter matches
const POSITION_GROUP: Record<string, string[]> = {
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
};

export function usePlayerFilter(
  players: PlayerSeasonStats[] | undefined,
  scoringWeights?: ScoringWeight[],
  /** Optional set of player IDs whose recent minutes are up vs season avg */
  minutesUpPlayerIds?: Set<string>,
  /** Optional map of tricode → game info for the currently selected game date */
  scheduleMap?: Map<string, unknown>,
  /** Optional set of watchlisted player IDs */
  watchlistedIds?: Set<string>,
  /** Optional set of rostered player IDs in this league */
  rosteredPlayerIds?: Set<string>,
  /** Externally-controlled "playing on date" filter (YYYY-MM-DD, or null for off) */
  playingOnDate?: string | null,
  /** Setter for the "playing on date" filter */
  onPlayingOnDateChange?: (date: string | null) => void,
  /** When this value changes, the free-text search resets (e.g. league switch) */
  resetKey?: string,
  /** Categories leagues have no fantasy points — default to PPG, hide FPTS sort */
  isCategories?: boolean,
) {
  // Categories leagues can't sort by FPTS (it doesn't exist), so they default
  // to PPG. Points leagues keep FPTS as the default.
  const defaultSort: SortKey = isCategories ? 'PPG' : 'FPTS';
  const [searchText, setSearchText] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');
  const [selectedProTeam, setSelectedProTeam] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>(defaultSort);
  const [showMinutesUp, setShowMinutesUp] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showRookiesOnly, setShowRookiesOnly] = useState(false);
  const [showFreeAgentsOnly, setShowFreeAgentsOnly] = useState(true);
  const [injuryFilter, setInjuryFilter] = useState<InjuryFilter>('all');

  // Clear the free-text search when the caller's resetKey changes (the active
  // league switched). The search query is per-league context that shouldn't
  // carry over; position/sort chips intentionally persist. No-op on mount.
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey !== prevResetKey.current) {
      prevResetKey.current = resetKey;
      setSearchText('');
    }
  }, [resetKey]);

  // scoring_type can resolve after mount (cold cache), so the initial `useState`
  // default may have been computed while isCategories was still false. Once we
  // know it's a categories league, coerce the stale FPTS default to PPG — FPTS
  // is never a valid sort there, so this can't clobber a real user choice.
  useEffect(() => {
    if (isCategories) {
      setSortBy(prev => (prev === 'FPTS' ? 'PPG' : prev));
    }
  }, [isCategories]);

  // A "rookie" is a player drafted in the current season. The `rookie` boolean
  // on player_season_stats is only populated for NBA draft prospects, so we
  // match on draft_year instead — populated for both sports and sport-correct
  // (NBA "2025-26" → 2025, WNBA "2026" → 2026).
  const sport = useActiveLeagueSport();
  const rookieDraftYear = parseSeasonStartYear(getCurrentSeason(sport));

  const filteredPlayers = useMemo(() => {
    if (!players) return [];

    let result = players;

    // Filter by name
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(query));
    }

    // Filter by pro team (tricode match on pro_team field)
    if (selectedProTeam !== 'All') {
      result = result.filter(p => p.pro_team === selectedProTeam);
    }

    // Filter by position (uses spectrum + group support)
    if (selectedPosition !== 'All') {
      const groupPositions = POSITION_GROUP[selectedPosition];
      if (groupPositions) {
        result = result.filter(p => {
          const eligible = p.position ? getEligiblePositions(p.position) : [];
          return groupPositions.some(gp => eligible.includes(gp));
        });
      } else {
        result = result.filter(p =>
          p.position && getEligiblePositions(p.position).includes(selectedPosition)
        );
      }
    }

    // Minutes up: players whose recent 5-game avg minutes > 110% of season avg
    if (showMinutesUp && minutesUpPlayerIds) {
      result = result.filter(p => minutesUpPlayerIds.has(p.player_id));
    }

    // Playing on selected date: only players whose team has a game on that date
    if (playingOnDate && scheduleMap) {
      result = result.filter(p => p.pro_team && scheduleMap.has(p.pro_team));
    }

    // Free agents only: exclude rostered players (default ON)
    if (showFreeAgentsOnly) {
      if (!rosteredPlayerIds) return []; // don't show unfiltered results while loading
      result = result.filter(p => !rosteredPlayerIds.has(p.player_id));
    }

    // Watchlist only
    if (showWatchlistOnly && watchlistedIds) {
      result = result.filter(p => watchlistedIds.has(p.player_id));
    }

    // Rookies only — players drafted in the current season
    if (showRookiesOnly) {
      result = result.filter(p => p.draft_year === rookieDraftYear);
    }

    // Injury status filter
    if (injuryFilter === 'healthy') {
      result = result.filter(p => !OUT_STATUSES.has(p.status));
    } else if (injuryFilter === 'injured') {
      result = result.filter(p => OUT_STATUSES.has(p.status));
    }

    // Sort — pre-compute FPTS once (N calculations) instead of inside
    // the comparator (N×log(N) calculations)
    if (sortBy === 'FPTS' && scoringWeights) {
      const fptsMap = new Map<string, number>();
      for (const p of result) {
        fptsMap.set(p.player_id, calculateAvgFantasyPoints(p, scoringWeights, sport));
      }
      result = [...result].sort((a, b) =>
        (fptsMap.get(b.player_id) ?? 0) - (fptsMap.get(a.player_id) ?? 0),
      );
    } else if (sortBy === 'FG%' || sortBy === 'FT%') {
      result = [...result].sort((a, b) => getComputedSort(b, sortBy) - getComputedSort(a, sortBy));
    } else if (sortBy !== 'FPTS') {
      const field = SORT_FIELD[sortBy];
      result = [...result].sort((a, b) => (b[field] as number) - (a[field] as number));
    }

    return result;
  }, [players, searchText, selectedPosition, selectedProTeam, sortBy, scoringWeights, sport, showMinutesUp, minutesUpPlayerIds, playingOnDate, scheduleMap, showWatchlistOnly, watchlistedIds, showRookiesOnly, rookieDraftYear, showFreeAgentsOnly, rosteredPlayerIds, injuryFilter]);

  const filterBarProps = {
    searchText,
    onSearchChange: setSearchText,
    selectedPosition,
    onPositionChange: setSelectedPosition,
    selectedProTeam,
    onProTeamChange: setSelectedProTeam,
    sortBy,
    onSortChange: setSortBy as (sort: string) => void,
    showMinutesUp,
    onMinutesUpChange: setShowMinutesUp,
    hasMinutesData: !!minutesUpPlayerIds,
    playingOnDate: playingOnDate ?? null,
    onPlayingOnDateChange,
    hasScheduleData: !!onPlayingOnDateChange,
    showWatchlistOnly,
    onWatchlistOnlyChange: setShowWatchlistOnly,
    hasWatchlistData: !!watchlistedIds && watchlistedIds.size > 0,
    showRookiesOnly,
    onRookiesOnlyChange: setShowRookiesOnly,
    showFreeAgentsOnly,
    onFreeAgentsOnlyChange: setShowFreeAgentsOnly,
    injuryFilter,
    onInjuryFilterChange: setInjuryFilter,
    hasRosteredData: rosteredPlayerIds !== undefined,
    isCategories: !!isCategories,
  };

  return { filteredPlayers, filterBarProps };
}
