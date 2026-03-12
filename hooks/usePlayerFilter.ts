import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { getEligiblePositions } from '@/utils/rosterSlots';
import { useMemo, useState } from 'react';

export type SortKey = 'FPTS' | 'PPG' | 'RPG' | 'APG' | 'SPG' | 'BPG' | 'MPG';
export type TimeRange = 'season' | '7d' | '14d' | '30d';

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
  /** Optional map of player_id → avg minutes over last 5 games */
  recentMinutesMap?: Map<string, number>,
  /** Optional map of tricode → game info for today's schedule */
  todaySchedule?: Map<string, string>,
) {
  const [searchText, setSearchText] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>('FPTS');
  const [showMinutesUp, setShowMinutesUp] = useState(false);
  const [showAvailableToday, setShowAvailableToday] = useState(false);

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
    if (showMinutesUp && recentMinutesMap) {
      result = result.filter(p => {
        const recentMin = recentMinutesMap.get(p.player_id);
        if (recentMin == null) return false;
        return p.avg_min > 0 && recentMin > p.avg_min * 1.1;
      });
    }

    // Available today: only players whose team has a game today
    if (showAvailableToday && todaySchedule) {
      result = result.filter(p => p.nba_team && todaySchedule.has(p.nba_team));
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
  }, [players, searchText, selectedPosition, sortBy, scoringWeights, showMinutesUp, recentMinutesMap, showAvailableToday, todaySchedule]);

  const filterBarProps = {
    searchText,
    onSearchChange: setSearchText,
    selectedPosition,
    onPositionChange: setSelectedPosition,
    sortBy,
    onSortChange: setSortBy as (sort: string) => void,
    showMinutesUp,
    onMinutesUpChange: setShowMinutesUp,
    hasMinutesData: !!recentMinutesMap,
    showAvailableToday,
    onAvailableTodayChange: setShowAvailableToday,
    hasScheduleData: !!todaySchedule,
  };

  return { filteredPlayers, filterBarProps };
}
