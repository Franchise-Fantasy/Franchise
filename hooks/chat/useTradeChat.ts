import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import type { TradeUpdateEvent } from '@/types/chat';

/**
 * Returns a mutation that finds or creates a trade conversation
 * and posts a trade_update system message into it.
 *
 * Uses a single SECURITY DEFINER RPC so system messages (team_id=null)
 * bypass the chat_messages RLS policy.
 *
 * All calls are fire-and-forget — callers should `.mutate()` without awaiting.
 */
export function usePostTradeUpdate(leagueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      proposalId,
      teamIds,
      event,
      teamName,
      actingTeamId,
    }: {
      proposalId: string;
      teamIds: string[];
      event: TradeUpdateEvent;
      teamName: string | null;
      /** The team performing the action (used as message sender). Null for system events. */
      actingTeamId: string | null;
    }) => {
      const { data: conversationId, error } = await supabase.rpc(
        'post_trade_update',
        {
          p_league_id: leagueId,
          p_proposal_id: proposalId,
          p_team_ids: teamIds,
          p_event: event,
          p_team_name: teamName ?? undefined,
          p_acting_team_id: actingTeamId ?? undefined,
        },
      );
      if (error) throw error;
      return conversationId as string;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(leagueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chatUnread(leagueId) });
    },
  });
}

/**
 * Returns a mutation that resolves the trade conversation ID for a given proposal.
 * Used by the "Chat" button on TradeDetailModal.
 */
export function useGetTradeConversation(leagueId: string) {
  return useMutation({
    mutationFn: async ({
      proposalId,
      teamIds,
    }: {
      proposalId: string;
      teamIds: string[];
    }) => {
      const { data: conversationId, error } = await supabase.rpc(
        'get_or_create_trade_conversation',
        {
          p_league_id: leagueId,
          p_proposal_id: proposalId,
          p_team_ids: teamIds,
        },
      );
      if (error) throw error;
      return conversationId as string;
    },
  });
}
