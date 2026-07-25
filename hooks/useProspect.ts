import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { contentful } from '@/lib/contentful';
import { mapProspectProfile } from '@/lib/prospect-mappers';
import { supabase } from '@/lib/supabase';
import type { ProspectProfileData, RecentGame } from '@/types/prospect';

/**
 * Fetch a single prospect's full profile: the `prospectProfile` Contentful
 * entry (by slug) merged with the consensus rank + weekly movement
 * (prospect_board) and the last 3 game lines (player_last_games).
 *
 * `id` is either the player's slug (the universal key), or a players.id UUID
 * (from "My Board", which only knows player_id) — the UUID is bridged to its
 * slug first.
 */
export function useProspect(id: string | undefined, idType: 'slug' | 'player' = 'player') {
  const sport = useActiveLeagueSport();
  return useQuery<ProspectProfileData | null>({
    queryKey: [...queryKeys.prospect(id!), sport],
    queryFn: async () => {
      // Resolve the slug (the join key). A players.id UUID is bridged first.
      let slug = id!;
      let knownPlayerId = '';
      if (idType === 'player') {
        const { data, error } = await supabase
          .from('players')
          .select('id, player_slug')
          .eq('id', id!)
          .single();
        if (error || !data?.player_slug) return null;
        slug = data.player_slug;
        knownPlayerId = data.id;
      }

      const response = await contentful.getEntries({
        content_type: 'prospectProfile',
        'fields.slug': slug,
        limit: 1,
      });
      const entry = response.items[0];
      if (!entry) return null;
      const profile = mapProspectProfile(entry);

      // Consensus rank + weekly movement + current team, joined on slug.
      const { data: board } = await supabase
        .from('prospect_board')
        .select('display_rank, rank_change, team')
        .eq('player_slug', slug)
        .maybeSingle();
      if (board) {
        profile.displayRank = board.display_rank ?? undefined;
        profile.rankChange = board.rank_change;
        profile.currentTeam = board.team ?? profile.currentTeam;
      }

      // Last 3 game lines across competitions (view caps at 3, newest first).
      const { data: games } = await supabase
        .from('player_last_games')
        .select('competition, game_date, opponent, minutes, points, rebounds, assists, steals, blocks, fg, fg3, ft')
        .eq('player_slug', slug)
        .order('game_date', { ascending: false });
      profile.recentGames = (games ?? []).map((g): RecentGame => ({
        competition: g.competition as RecentGame['competition'],
        gameDate: g.game_date ?? '',
        opponent: g.opponent,
        minutes: g.minutes,
        points: g.points,
        rebounds: g.rebounds,
        assists: g.assists,
        steals: g.steals,
        blocks: g.blocks,
        fg: g.fg,
        fg3: g.fg3,
        ft: g.ft,
      }));

      // Resolve the draftable players.id for board/news linkage.
      if (knownPlayerId) {
        profile.playerId = knownPlayerId;
      } else {
        const { data } = await supabase
          .from('players')
          .select('id')
          .eq('sport', sport)
          .eq('is_prospect', true)
          .eq('player_slug', slug)
          .maybeSingle();
        profile.playerId = data?.id ?? '';
      }

      return profile;
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  });
}
