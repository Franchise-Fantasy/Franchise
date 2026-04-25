import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { getEligiblePositions } from '@/utils/rosterSlots';
import { useMemo, useState } from 'react';

export type SortKey = 'FPTS' | 'PPG' | 'RPG' | 'APG' | 'SPG' | 'BPG' | 'MPG' | 'FG%' | 'FT%' | 'TO';
export type TimeRange = 'season' | '7d' | '14d' | '30d' | 'lastSeason';

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
export type PositionFilter = (typeof POSITIONS)[number];
export { POSITIONS };

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
) {
  const [searchText, setSearchText] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>('FPTS');
  const [showMinutesUp, setShowMinutesUp] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showFreeAgentsOnly, setShowFreeAgentsOnly] = useState(true);
  const [injuryFilter, setInjuryFilter] = useState<InjuryFilter>('all');

  const filteredPlayers = useMemo(() => {
    if (!players) return [];

    let result = players;

    // Filter by name
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(query));
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
        fptsMap.set(p.player_id, calculateAvgFantasyPoints(p, scoringWeights));
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
  }, [players, searchText, selectedPosition, sortBy, scoringWeights, showMinutesUp, minutesUpPlayerIds, playingOnDate, scheduleMap, showWatchlistOnly, watchlistedIds, showFreeAgentsOnly, rosteredPlayerIds, injuryFilter]);

  const filterBarProps = {
    searchText,
    onSearchChange: setSearchText,
    selectedPosition,
    onPositionChange: setSelectedPosition,
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
    showFreeAgentsOnly,
    onFreeAgentsOnlyChange: setShowFreeAgentsOnly,
    injuryFilter,
    onInjuryFilterChange: setInjuryFilter,
    hasRosteredData: rosteredPlayerIds !== undefined,
  };

  return { filteredPlayers, filterBarProps };
}
