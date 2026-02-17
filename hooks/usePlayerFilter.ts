import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { useMemo, useState } from 'react';

export type SortKey = 'FPTS' | 'PPG' | 'RPG' | 'APG' | 'SPG' | 'BPG' | 'MPG';

const SORT_FIELD: Record<Exclude<SortKey, 'FPTS'>, keyof PlayerSeasonStats> = {
  PPG: 'avg_pts',
  RPG: 'avg_reb',
  APG: 'avg_ast',
  SPG: 'avg_stl',
  BPG: 'avg_blk',
  MPG: 'avg_min',
};

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C'] as const;
export type PositionFilter = (typeof POSITIONS)[number];
export { POSITIONS };

// Maps position filter to substrings that match (e.g. "PG" matches "Guard", "PG", etc.)
const POSITION_MATCH: Record<string, string[]> = {
  PG: ['Guard', 'PG'],
  SG: ['Guard', 'SG'],
  SF: ['Forward', 'SF'],
  PF: ['Forward', 'PF'],
  C: ['Center', 'C'],
};

export function usePlayerFilter(
  players: PlayerSeasonStats[] | undefined,
  scoringWeights?: ScoringWeight[]
) {
  const [searchText, setSearchText] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>('FPTS');

  const filteredPlayers = useMemo(() => {
    if (!players) return [];

    let result = players;

    // Filter by name
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(query));
    }

    // Filter by position
    if (selectedPosition !== 'All') {
      const matchTerms = POSITION_MATCH[selectedPosition] || [selectedPosition];
      result = result.filter(p =>
        p.position && matchTerms.some(term => p.position.includes(term))
      );
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
  }, [players, searchText, selectedPosition, sortBy, scoringWeights]);

  const filterBarProps = {
    searchText,
    onSearchChange: setSearchText,
    selectedPosition,
    onPositionChange: setSelectedPosition,
    sortBy,
    onSortChange: setSortBy as (sort: string) => void,
  };

  return { filteredPlayers, filterBarProps };
}
