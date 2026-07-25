import { useQuery } from '@tanstack/react-query';

import { SPORT_DISPLAY } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { contentful } from '@/lib/contentful';
import { mapProspectCard } from '@/lib/prospect-mappers';
import { supabase } from '@/lib/supabase';
import type { ProspectCardData } from '@/types/prospect';


/**
 * Fetch the prospect list for a given draft year: published `prospectProfile`
 * entries from Contentful, enriched with the consensus rank + weekly movement
 * from the Supabase prospect_board (joined on slug), sorted by display_rank.
 * Filters out prospects already rostered in the user's current league.
 */
export function useProspects(draftYear: string, enabled: boolean = true) {
  const { leagueId } = useAppState();
  const sport = useActiveLeagueSport();
  const contentfulSport = SPORT_DISPLAY[sport]; // 'NBA' | 'WNBA'
  // Tabs carry a display suffix (e.g. "2029+"); the field is an integer.
  const draftYearInt = parseInt(draftYear, 10);

  // Fetch Contentful entries
  const contentfulQuery = useQuery<ProspectCardData[]>({
    queryKey: [...queryKeys.prospects(draftYear), sport],
    queryFn: async () => {
      const response = await contentful.getEntries({
        content_type: 'prospectProfile',
        'fields.sport': contentfulSport,
        'fields.draftYear': draftYearInt,
        limit: 200,
      });
      return response.items.map(mapProspectCard);
    },
    enabled,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch the consensus board (rank + movement) for this class, plus the
  // slug→players.id bridge and the league's rostered ids for filtering.
  const boardQuery = useQuery({
    queryKey: [...queryKeys.prospectPlayers(leagueId ?? ''), sport, draftYearInt],
    queryFn: async () => {
      const { data: board, error: bErr } = await supabase
        .from('prospect_board')
        .select('player_slug, display_rank, rank_change, team, updated_at')
        .eq('draft_year', draftYearInt);
      if (bErr) throw bErr;

      // Prospect rows carry the slug bridge; resolves to a draftable players.id.
      const { data: prospects, error: pErr } = await supabase
        .from('players')
        .select('id, player_slug')
        .eq('sport', sport)
        .eq('is_prospect', true)
        .eq('status', 'prospect');
      if (pErr) throw pErr;

      let rosteredIds: Set<string> = new Set();
      if (leagueId) {
        const { data: rostered } = await supabase
          .from('league_players')
          .select('player_id')
          .eq('league_id', leagueId);
        rosteredIds = new Set((rostered ?? []).map(r => r.player_id));
      }

      return { board: board ?? [], prospects: prospects ?? [], rosteredIds };
    },
    enabled: enabled && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  // Merge: attach rank/movement/playerId by slug, drop rostered, sort by rank.
  const data: ProspectCardData[] | undefined = (() => {
    if (!contentfulQuery.data || !boardQuery.data) return contentfulQuery.data;

    const { board, prospects, rosteredIds } = boardQuery.data;
    const boardBySlug = new Map(board.map(b => [b.player_slug, b]));
    const playerBySlug = new Map(
      prospects.filter(p => p.player_slug).map(p => [p.player_slug as string, p.id]),
    );

    return contentfulQuery.data
      .map(card => {
        const b = boardBySlug.get(card.slug);
        return {
          ...card,
          playerId: playerBySlug.get(card.slug) ?? '',
          displayRank: b?.display_rank ?? undefined,
          rankChange: b ? b.rank_change : undefined,
          currentTeam: b?.team ?? card.currentTeam,
          lastUpdated: b?.updated_at ?? undefined,
        };
      })
      .filter(card => !card.playerId || !rosteredIds.has(card.playerId))
      // Ranked prospects first (by consensus rank); unranked fall to the bottom.
      .sort((a, b) => (a.displayRank ?? Infinity) - (b.displayRank ?? Infinity));
  })();

  return {
    data,
    isLoading: contentfulQuery.isLoading || boardQuery.isLoading,
    error: contentfulQuery.error || boardQuery.error,
    refetch: () => {
      contentfulQuery.refetch();
      boardQuery.refetch();
    },
  };
}
