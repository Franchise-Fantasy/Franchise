import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog } from '@/types/player';
import { dedupeGameLogsByDate } from '@/utils/scoring/gameLogDedup';

/**
 * Batch game-log fetch for a whole roster in one query, keyed by player_id.
 * Powers the roster hot/cold trend board. Roster-bounded (~15-20 players) and
 * only fetched when the analytics tab is open, so a single `.in()` query is
 * cheap; the recent-window slice happens in-memory in calculatePlayerInsights.
 * Same same-date dedup as usePlayerGameLog (shared helper) so a board row's
 * trend matches the player-detail modal exactly.
 */
export function useRosterGameLogs(playerIds: string[]) {
  const sport = useActiveLeagueSport();
  // Stable key regardless of roster order so the cache doesn't fragment.
  const sortedIds = [...playerIds].sort();

  return useQuery<Map<string, PlayerGameLog[]>>({
    queryKey: [...queryKeys.rosterGameLogs(sortedIds), sport],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_games')
        .select('*')
        .eq('sport', sport)
        .in('player_id', sortedIds)
        .order('game_date', { ascending: false });

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
