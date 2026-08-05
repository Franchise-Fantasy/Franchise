/**
 * Saved poll/survey composer state — see
 * supabase/migrations/20260804160000_commissioner_content_drafts.sql.
 *
 * Straight PostgREST rather than an edge function: the table is a private,
 * RLS-owned scratchpad (own rows, own league only), so there's no
 * cross-user authorization for a function to enforce and a round trip through
 * one would only add latency to a Save button. Publishing still goes through
 * create-poll / create-survey, which is where the real validation lives.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database.types';
import type {
  CommissionerContentDraft,
  ContentDraftKind,
  PollDraftForm,
  SurveyDraftForm,
} from '@/utils/chat/contentDraftBody';

export function useContentDrafts(conversationId: string | null, enabled: boolean) {
  return useQuery<CommissionerContentDraft[]>({
    queryKey: queryKeys.contentDrafts(conversationId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissioner_content_drafts')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CommissionerContentDraft[];
    },
    enabled: !!conversationId && enabled,
    staleTime: 60 * 1000,
  });
}

interface SaveContentDraftParams {
  /** Present when re-saving a draft that's already been opened from the list. */
  id: string | null;
  league_id: string;
  conversation_id: string;
  kind: ContentDraftKind;
  body: PollDraftForm | SurveyDraftForm;
}

export function useSaveContentDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, league_id, conversation_id, kind, body }: SaveContentDraftParams) => {
      // The form types are interfaces, which TS won't structurally accept as
      // the generated `Json` column type even though the shape is plain JSON.
      const payload = body as unknown as Json;

      if (id) {
        const { data, error } = await supabase
          .from('commissioner_content_drafts')
          .update({ body: payload })
          .eq('id', id)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (data) return data.id as string;
        // The row is gone — deleted from the drafts list on another device
        // while this composer was open. Falling through to the insert saves
        // the work instead of failing the one action meant to preserve it.
      }
      // created_by defaults to auth.uid() in the DB, so the client never needs
      // its own user id here.
      const { data, error } = await supabase
        .from('commissioner_content_drafts')
        .insert({ league_id, conversation_id, kind, body: payload })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentDrafts(variables.conversation_id),
      });
    },
  });
}

export function useDeleteContentDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; conversationId: string }) => {
      const { error } = await supabase
        .from('commissioner_content_drafts')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentDrafts(variables.conversationId),
      });
    },
  });
}
