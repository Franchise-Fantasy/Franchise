import { useQuery } from '@tanstack/react-query';

import { SPORT_DISPLAY, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { contentful } from '@/lib/contentful';
import { assetUrl } from '@/lib/prospect-mappers';
import { supabase } from '@/lib/supabase';

/**
 * Scouting-photo URLs for one draft class, keyed by `players.id`.
 *
 * Prospects have no `external_id_nba` until they turn pro, so every headshot
 * surface renders them as a silhouette. Their real photos live on the
 * Contentful `prospectProfile` entries keyed by slug — this walks the same
 * `players.player_slug` bridge as `useProspectConsensus` and hands back a Map
 * the rookie-draft surfaces can look up by a pool row's player_id.
 */
export function useProspectPhotos(
  sport: Sport,
  draftYear: number | undefined,
  enabled: boolean = true,
) {
  return useQuery<Map<string, string>>({
    queryKey: queryKeys.prospectPhotos(sport, draftYear ?? 0),
    queryFn: async () => {
      const response = await contentful.getEntries({
        content_type: 'prospectProfile',
        'fields.sport': SPORT_DISPLAY[sport],
        'fields.draftYear': draftYear!,
        limit: 200,
      });

      const photoBySlug = new Map<string, string>();
      for (const entry of response.items) {
        const f = (entry as any)?.fields ?? {};
        const url = assetUrl(f.photo);
        if (f.slug && url) photoBySlug.set(f.slug, url);
      }
      if (photoBySlug.size === 0) return new Map();

      // Scoped to the class's slugs — a class is ~100 rows, comfortably clear
      // of PostgREST's 1000-row cap.
      const { data: players, error } = await supabase
        .from('players')
        .select('id, player_slug')
        .eq('sport', sport)
        .in('player_slug', [...photoBySlug.keys()]);
      if (error) throw error;

      const photos = new Map<string, string>();
      for (const p of players ?? []) {
        const url = p.player_slug ? photoBySlug.get(p.player_slug) : undefined;
        if (url) photos.set(p.id, url);
      }
      return photos;
    },
    enabled: enabled && !!draftYear,
    // CMS photos change on editorial cadence — effectively static in-session.
    staleTime: 1000 * 60 * 30,
  });
}
