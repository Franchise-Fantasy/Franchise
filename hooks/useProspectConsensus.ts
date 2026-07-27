import { useQuery } from '@tanstack/react-query';

import type { Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

/**
 * The blended consensus rank for one draft class, keyed by `players.id`.
 *
 * The weekly rankings pipeline writes `prospect_board` keyed on `player_slug`,
 * but every draftable surface (the rookie-draft pool, prospect_boards) keys on
 * `players.id` — so this walks the `players.player_slug` bridge and hands back a
 * Map the caller can look up directly.
 */
export function useProspectConsensus(
  sport: Sport,
  draftYear: number | undefined,
  enabled: boolean = true,
) {
  return useQuery<Map<string, number>>({
    queryKey: queryKeys.prospectConsensus(sport, draftYear ?? 0),
    queryFn: async () => {
      const { data: board, error: boardError } = await supabase
        .from('prospect_board')
        .select('player_slug, display_rank')
        .eq('draft_year', draftYear!);
      if (boardError) throw boardError;

      const slugs = (board ?? [])
        .map(b => b.player_slug)
        .filter((slug): slug is string => !!slug);
      if (slugs.length === 0) return new Map();

      // Scoped to the class's slugs rather than "every player with a slug" —
      // a class is ~100 rows, comfortably clear of PostgREST's 1000-row cap.
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('id, player_slug')
        .eq('sport', sport)
        .in('player_slug', slugs);
      if (playersError) throw playersError;

      const idBySlug = new Map(
        (players ?? [])
          .filter(p => !!p.player_slug)
          .map(p => [p.player_slug as string, p.id]),
      );

      const ranks = new Map<string, number>();
      for (const row of board ?? []) {
        if (!row.player_slug || row.display_rank == null) continue;
        const playerId = idBySlug.get(row.player_slug);
        if (playerId) ranks.set(playerId, row.display_rank);
      }
      return ranks;
    },
    enabled: enabled && !!draftYear,
    // The pipeline scrapes weekly, so this is effectively static within a session.
    staleTime: 1000 * 60 * 30,
  });
}
