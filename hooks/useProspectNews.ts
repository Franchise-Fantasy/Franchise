import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { ProspectNewsItem } from '@/types/prospect';
import { useQuery } from '@tanstack/react-query';

/** Fetch news articles mentioning a specific prospect. */
export function useProspectNews(playerId: string | undefined) {
  return useQuery<ProspectNewsItem[]>({
    queryKey: queryKeys.prospectNews(playerId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospect_news_mentions')
        .select('news_id, prospect_news(id, title, description, link, source, published_at)')
        .eq('player_id', playerId!)
        .order('prospect_news(published_at)', { ascending: false })
        .limit(10);

      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.prospect_news as ProspectNewsItem)
        .filter(Boolean);
    },
    enabled: !!playerId,
    staleTime: 1000 * 60 * 10,
  });
}
