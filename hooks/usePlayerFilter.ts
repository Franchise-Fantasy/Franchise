import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { getEligiblePositions } from '@/utils/rosterSlots';
import { useMemo, useState } from 'react';

export type SortKey = 'FPTS' | 'PPG' | 'RPG' | 'APG' | 'SPG' | 'BPG' | 'MPG';
export type TimeRange = 'season' | '7d' | '14d' | '30d' | 'lastSeason';

const SORT_FIELD: Record<Exclude<SortKey, 'FPTS'>, keyof PlayerSeasonStats> = {
  PPG: 'avg_pts',
  RPG: 'avg_reb',
  APG: 'avg_ast',
  SPG: 'avg_stl',
  BPG: 'avg_blk',
  MPG: 'avg_min',
};

const POSITIONS = ['All', 'G', 'F', 'PG', 'SG', 'SF', 'PF', 'C'] as const;
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
  /** Optional map of tricode → game info for today's schedule */
  todaySchedule?: Map<string, string>,
  /** Optional set of watchlisted player IDs */
  watchlistedIds?: Set<string>,
  /** Optional set of rostered player IDs in this league */
  rosteredPlayerIds?: Set<string>,
) {
  const [searchText, setSearchText] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>('FPTS');
  const [showMinutesUp, setShowMinutesUp] = useState(false);
  const [showAvailableToday, setShowAvailableToday] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showFreeAgentsOnly, setShowFreeAgentsOnly] = useState(true);

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

    // Available today: only players whose team has a game today
    if (showAvailableToday && todaySchedule) {
      result = result.filter(p => p.nba_team && todaySchedule.has(p.nba_team));
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

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'FPTS') {
        if (!scoringWeights) return 0;
        return calculateAvgFantasyPoints(b, scoringWeights) - calculateAvgFantasyPoints(a, scoringWeights);
      }
      const field = SORT_FIELD[sortBy];
      return (b[field] as number) - (a[field] as number);
    });

    return result;
  }, [players, searchText, selectedPosition, sortBy, scoringWeights, showMinutesUp, minutesUpPlayerIds, showAvailableToday, todaySchedule, showWatchlistOnly, watchlistedIds, showFreeAgentsOnly, rosteredPlayerIds]);

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
    showAvailableToday,
    onAvailableTodayChange: setShowAvailableToday,
    hasScheduleData: !!todaySchedule,
    showWatchlistOnly,
    onWatchlistOnlyChange: setShowWatchlistOnly,
    hasWatchlistData: !!watchlistedIds && watchlistedIds.size > 0,
    showFreeAgentsOnly,
    onFreeAgentsOnlyChange: setShowFreeAgentsOnly,
    hasRosteredData: rosteredPlayerIds !== undefined,
  };

  return { filteredPlayers, filterBarProps };
}
