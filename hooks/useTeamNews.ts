import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import type { Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';
import type { PlayerNewsArticle } from '@/types/news';

/** Fetch news articles mentioning any of the given players, or all recent news. */
export function useTeamNews(
  playerIds: string[],
  mode: 'filtered' | 'all' = 'filtered',
  sport: Sport | undefined = undefined,
) {
  return useQuery<PlayerNewsArticle[]>({
    queryKey: queryKeys.teamNews(mode, playerIds, sport),
    queryFn: async () => {
      if (mode === 'all') {
        // Sport scoping: 'all' mode reads from player_news directly, so we MUST
        // filter by sport — otherwise an NBA league sees WNBA articles (and vice
        // versa). The 'filtered' branch below is implicitly sport-isolated
        // because player IDs only roster within a single-sport league.
        const { data, error } = await supabase
          .from('player_news')
          .select('id, title, description, link, source, published_at, has_minutes_restriction, return_estimate, mentioned_players')
          .eq('sport', sport!)
          .order('published_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return (data ?? []) as PlayerNewsArticle[];
      }

      // Filtered mode: fetch by player IDs via junction table
      if (playerIds.length === 0) return [];

      const { data, error } = await supabase
        .from('player_news_mentions')
        .select('player_news(id, title, description, link, source, published_at, has_minutes_restriction, return_estimate, mentioned_players)')
        .in('player_id', playerIds)
        .order('player_news(published_at)', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Deduplicate: one article may mention multiple rostered players
      const seen = new Map<string, PlayerNewsArticle>();
      for (const row of data ?? []) {
        const article = (Array.isArray(row.player_news) ? row.player_news[0] : row.player_news) as PlayerNewsArticle | null;
        if (!article) continue;
        if (!seen.has(article.id)) seen.set(article.id, article);
      }

      return [...seen.values()].sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    },
    enabled: mode === 'all' ? !!sport : playerIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
}
