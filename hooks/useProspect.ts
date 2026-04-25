import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { contentful } from '@/lib/contentful';
import { mapProspectProfile } from '@/lib/prospect-mappers';
import { supabase } from '@/lib/supabase';
import type { ProspectProfileData } from '@/types/prospect';

/**
 * Fetch a single prospect's full profile from Contentful.
 * Accepts either a Contentful entry ID directly, or a players.id UUID
 * (which looks up the contentful_entry_id first).
 */
export function useProspect(id: string | undefined, idType: 'contentful' | 'player' = 'player') {
  return useQuery<ProspectProfileData | null>({
    queryKey: queryKeys.prospect(id!),
    queryFn: async () => {
      let entryId = id!;

      // If we have a player UUID, look up the Contentful entry ID
      if (idType === 'player') {
        const { data, error } = await supabase
          .from('players')
          .select('contentful_entry_id')
          .eq('id', id!)
          .single();

        if (error || !data?.contentful_entry_id) return null;
        entryId = data.contentful_entry_id;
      }

      const entry = await contentful.getEntry(entryId);
      const profile = mapProspectProfile(entry);

      // Fill in the player UUID
      if (idType === 'contentful') {
        const { data } = await supabase
          .from('players')
          .select('id')
          .eq('contentful_entry_id', entryId)
          .single();
        profile.playerId = data?.id ?? '';
      } else {
        profile.playerId = id!;
      }

      return profile;
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  });
}
