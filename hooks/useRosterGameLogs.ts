import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { getPreviousSeason, getSeasonEnd } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';
import { dedupeGameLogsByDate } from '@/utils/scoring/gameLogDedup';

/**
 * Batch game-log fetch for a roster in one query, keyed by player_id.
 *
 * Powers the roster hot/cold trend board AND the windowed league-strength
 * comparison (when fed every active league player_id). Recent-window slicing
 * happens in-memory. Same same-date dedup as usePlayerGameLog so a board row's
 * trend matches the player-detail modal exactly.
 *
 * Supabase's default row cap (1000) was previously truncating mid-season for
 * deep dynasty leagues — bumped to 50k explicitly. The largest realistic
 * payload is ~12 teams × 15 players × ~80 games = ~14,400 rows.
 */
export function useRosterGameLogs(playerIds: string[]) {
  const sport = useActiveLeagueSport();
  // Stable key regardless of roster order so the cache doesn't fragment.
  const sortedIds = [...playerIds].sort();

  return useQuery<Map<string, PlayerGameLog[]>>({
    queryKey: [...queryKeys.rosterGameLogs(sortedIds), sport],
    queryFn: async () => {
      // Scope to the CURRENT season. player_games holds prior seasons too (for
      // the projections engine), so without this floor the windowed averages
      // (L5/L10/L15) would bleed into last season for players with fewer
      // current-season games than the window. Floor = the prior season's end,
      // identical to the player_season_stats matview.
      const priorEnd = getSeasonEnd(sport, getPreviousSeason(sport));
      let query = supabase
        .from('player_games')
        .select('*')
        .eq('sport', sport)
        .in('player_id', sortedIds);
      if (priorEnd) query = query.gt('game_date', priorEnd);
      const { data, error } = await query
        .order('game_date', { ascending: false })
        .limit(50000);

      if (error) throw error;

      // PlayerGameLog doesn't declare player_id (single-player queries don't
      // need it); the column exists on the row, so widen the type to group by it.
      const rows = (data ?? []) as (PlayerGameLog & { player_id: string })[];
      const byPlayer = new Map<string, PlayerGameLog[]>();
      for (const row of rows) {
        const list = byPlayer.get(row.player_id);
        if (list) list.push(row);
        else byPlayer.set(row.player_id, [row]);
      }
      // Dedupe each player's rows the same way the single-player hook does.
      for (const [pid, rows] of byPlayer) {
        byPlayer.set(pid, dedupeGameLogsByDate(rows));
      }
      return byPlayer;
    },
    enabled: sortedIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
}
