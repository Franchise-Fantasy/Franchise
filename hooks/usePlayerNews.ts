import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { PlayerNewsArticle } from '@/types/news';
import { useQuery } from '@tanstack/react-query';

/** Fetch news articles mentioning a specific player. */
export function usePlayerNews(playerId: string | undefined) {
  return useQuery<PlayerNewsArticle[]>({
    queryKey: queryKeys.playerNews(playerId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_news_mentions')
        .select('news_id, player_news(id, title, description, link, source, published_at, has_minutes_restriction, return_estimate)')
        .eq('player_id', playerId!)
        .order('player_news(published_at)', { ascending: false })
        .limit(20);

      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.player_news as PlayerNewsArticle)
        .filter(Boolean);
    },
    enabled: !!playerId,
    staleTime: 1000 * 60 * 5,
  });
}
