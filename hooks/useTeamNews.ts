import { supabase } from '@/lib/supabase';
import type { PlayerNewsArticle } from '@/types/news';
import { useQuery } from '@tanstack/react-query';

/** Fetch news articles mentioning any of the given players, or all recent news. */
export function useTeamNews(playerIds: string[], mode: 'filtered' | 'all' = 'filtered') {
  return useQuery<PlayerNewsArticle[]>({
    queryKey: ['teamNews', mode, playerIds],
    queryFn: async () => {
      if (mode === 'all') {
        const { data, error } = await supabase
          .from('player_news')
          .select('id, title, description, link, source, published_at, has_minutes_restriction, return_estimate')
          .order('published_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return (data ?? []) as PlayerNewsArticle[];
      }

      // Filtered mode: fetch by player IDs
      if (playerIds.length === 0) return [];

      const { data, error } = await supabase
        .from('player_news_mentions')
        .select('player_id, news_id, player_news(id, title, description, link, source, published_at, has_minutes_restriction, return_estimate)')
        .in('player_id', playerIds)
        .order('player_news(published_at)', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Deduplicate: one article may mention multiple rostered players
      const seen = new Map<string, PlayerNewsArticle>();
      for (const row of data ?? []) {
        const article = (row as any).player_news as PlayerNewsArticle;
        if (!article) continue;
        if (!seen.has(article.id)) seen.set(article.id, article);
      }

      return [...seen.values()].sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    },
    enabled: mode === 'all' || playerIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
}
