import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { getPreviousSeason, getSeasonEnd } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';
import { dedupeGameLogsByDate } from '@/utils/scoring/gameLogDedup';

// Per-sport game-log cap. Future sports default to a generous limit until
// wired up.
const GAME_LIMIT_BY_SPORT: Record<string, number> = {
  nba: 82, wnba: 40, nfl: 18, nhl: 82, mlb: 162,
};

export function usePlayerGameLog(playerId: string) {
  const sport = useActiveLeagueSport();
  const limit = GAME_LIMIT_BY_SPORT[sport] ?? 82;

  return useQuery<PlayerGameLog[]>({
    queryKey: [...queryKeys.playerGameLog(playerId), sport],
    queryFn: async () => {
      // Current season only — player_games now holds prior seasons (for the
      // projections engine), so floor at the prior season's end (same boundary
      // as the player_season_stats matview) to keep the game log + its windowed
      // averages from showing last season's games.
      const priorEnd = getSeasonEnd(sport, getPreviousSeason(sport));
      let query = supabase
        .from('player_games')
        .select('*')
        .eq('sport', sport)
        .eq('player_id', playerId);
      if (priorEnd) query = query.gt('game_date', priorEnd);
      const { data, error } = await query
        .order('game_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return dedupeGameLogsByDate(data as PlayerGameLog[]);
    },
    enabled: !!playerId,
    staleTime: 1000 * 60 * 5,
  });
}
