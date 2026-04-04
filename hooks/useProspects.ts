import { queryKeys } from '@/constants/queryKeys';
import { contentful } from '@/lib/contentful';
import { mapProspectCard } from '@/lib/prospect-mappers';
import { supabase } from '@/lib/supabase';
import { useAppState } from '@/context/AppStateProvider';
import type { ProspectCardData } from '@/types/prospect';
import { useQuery } from '@tanstack/react-query';

/**
 * Fetch prospect list from Contentful for a given draft year.
 * Filters out prospects already rostered in the user's current league.
 * Sorts by dynastyValueScore descending.
 */
export function useProspects(draftYear: string) {
  const { leagueId } = useAppState();

  // Fetch Contentful entries
  const contentfulQuery = useQuery<ProspectCardData[]>({
    queryKey: queryKeys.prospects(draftYear),
    queryFn: async () => {
      const response = await contentful.getEntries({
        content_type: 'prospect',
        'fields.sport': 'NBA',
        'fields.projectedDraftYear': draftYear,
        order: ['-fields.dynastyValueScore'],
        limit: 200,
      });
      return response.items.map(mapProspectCard);
    },
    staleTime: 1000 * 60 * 5,
  });

  // Fetch player IDs that are prospects in our DB (to get players.id and filter rostered)
  const playersQuery = useQuery({
    queryKey: queryKeys.prospectPlayers(leagueId ?? ''),
    queryFn: async () => {
      // Get all prospect player rows with their contentful_entry_id
      const { data: prospects, error: pErr } = await supabase
        .from('players')
        .select('id, contentful_entry_id')
        .eq('is_prospect', true)
        .eq('status', 'prospect');

      if (pErr) throw pErr;

      // Get rostered player IDs in this league
      let rosteredIds: Set<string> = new Set();
      if (leagueId) {
        const { data: rostered } = await supabase
          .from('league_players')
          .select('player_id')
          .eq('league_id', leagueId);
        rosteredIds = new Set((rostered ?? []).map(r => r.player_id));
      }

      return {
        prospects: prospects ?? [],
        rosteredIds,
      };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  // Merge: attach player IDs and filter out rostered prospects
  const data: ProspectCardData[] | undefined = (() => {
    if (!contentfulQuery.data || !playersQuery.data) return contentfulQuery.data;

    const { prospects, rosteredIds } = playersQuery.data;
    const entryToPlayer = new Map(
      prospects.map(p => [p.contentful_entry_id, p.id]),
    );

    return contentfulQuery.data
      .map(card => ({
        ...card,
        playerId: entryToPlayer.get(card.contentfulEntryId) ?? '',
      }))
      .filter(card => !card.playerId || !rosteredIds.has(card.playerId));
  })();

  return {
    data,
    isLoading: contentfulQuery.isLoading || playersQuery.isLoading,
    error: contentfulQuery.error || playersQuery.error,
    refetch: () => {
      contentfulQuery.refetch();
      playersQuery.refetch();
    },
  };
}
