import { queryKeys } from '@/constants/queryKeys';
import { capture } from '@/lib/posthog';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { isOnline } from '@/utils/network';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useToast } from '@/context/ToastProvider';
import { TradeProposalRow } from '@/hooks/useTrades';
import { usePostTradeUpdate } from '@/hooks/chat/useTradeChat';

interface UseTradeDetailActionsParams {
  proposal: TradeProposalRow;
  leagueId: string;
  teamId: string;
  leagueSettings: {
    trade_veto_type: string | null;
    trade_review_period_hours: number | null;
    trade_votes_to_veto: number | null;
    roster_size: number | null;
  } | undefined;
  myNetGain: number;
  selectedDropPlayerIds: string[];
  onClose: () => void;
}

export function useTradeDetailActions({
  proposal,
  leagueId,
  teamId,
  leagueSettings,
  myNetGain,
  selectedDropPlayerIds,
  onClose,
}: UseTradeDetailActionsParams) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [processing, setProcessing] = useState(false);
  const postTradeUpdate = usePostTradeUpdate(leagueId);

  const allTeamIds = proposal.teams.map((t) => t.team_id);

  /** Fire-and-forget trade chat update */
  const postUpdate = (event: 'accepted' | 'rejected' | 'cancelled' | 'vetoed', name: string | null) => {
    postTradeUpdate.mutate({
      proposalId: proposal.id,
      teamIds: allTeamIds,
      event,
      teamName: name,
      actingTeamId: null,
    });
  };

  const myProposalTeam = proposal.teams.find((t) => t.team_id === teamId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tradeProposals(leagueId) });
    queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.tradeVotes(proposal.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.tradeBlock(leagueId) });
  };

  const handleAccept = async (onNeedDrop: () => void) => {
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }

    // If gaining players and not enough drops selected, trigger the drop picker
    if (myNetGain > 0) {
      const rosterSize = leagueSettings?.roster_size ?? 13;
      const [allRes, irRes] = await Promise.all([
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId),
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId).eq('roster_slot', 'IR'),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      const dropsNeeded = Math.max(0, activeCount + myNetGain - rosterSize);
      if (dropsNeeded > 0 && selectedDropPlayerIds.length < dropsNeeded) {
        onNeedDrop();
        return;
      }
    }

    setProcessing(true);
    try {
      // Atomic accept: the RPC takes a row lock on the proposal, updates this
      // team's status + drops, checks whether every party has now accepted,
      // transitions the proposal (accepted / in_review), and cancels any
      // conflicting proposals — all in one transaction. Fixes the double-accept
      // race where concurrent accepts each missed the other's write and the
      // proposal silently stayed un-executed.
      const vetoType = leagueSettings?.trade_veto_type ?? 'commissioner';
      const reviewHours = leagueSettings?.trade_review_period_hours ?? 24;

      const { data: rpcResult, error: rpcError } = await supabase.rpc('accept_trade_proposal' as any, {
        p_proposal_id: proposal.id,
        p_team_id: teamId,
        p_drop_player_ids: selectedDropPlayerIds.length > 0 ? selectedDropPlayerIds : null,
        p_veto_type: vetoType,
        p_review_hours: reviewHours,
      });
      if (rpcError) throw rpcError;

      const result = rpcResult as {
        all_accepted: boolean;
        needs_review: boolean;
        already_finalized: boolean;
      };

      const myTeamName = myProposalTeam?.team_name ?? 'A team';

      if (result.all_accepted && !result.needs_review && !result.already_finalized) {
        // All parties accepted, no veto review configured — fire execution now.
        await supabase.functions.invoke('execute-trade', { body: { proposal_id: proposal.id } });
      } else if (result.all_accepted && result.needs_review) {
        sendNotification({
          league_id: leagueId,
          category: 'trades',
          title: 'Trade Under Review',
          body: 'A trade has been accepted and is now under review.',
          data: { screen: 'trades' },
        });
      } else if (!result.all_accepted) {
        sendNotification({
          league_id: leagueId,
          team_ids: [proposal.proposed_by_team_id],
          category: 'trades',
          title: 'Trade Accepted',
          body: `${myTeamName} has accepted your trade proposal.`,
          data: { screen: 'trades' },
        });
      }

      capture('trade_accepted');
      postUpdate('accepted', myTeamName);
      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to accept trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }
    setProcessing(true);
    try {
      await supabase
        .from('trade_proposal_teams')
        .update({ status: 'rejected', responded_at: new Date().toISOString() })
        .eq('proposal_id', proposal.id)
        .eq('team_id', teamId);

      await supabase
        .from('trade_proposals')
        .update({ status: 'rejected' })
        .eq('id', proposal.id);

      const myTeamName = myProposalTeam?.team_name ?? 'A team';
      const otherTeamIds = proposal.teams
        .filter((t) => t.team_id !== teamId)
        .map((t) => t.team_id);

      sendNotification({
        league_id: leagueId,
        team_ids: otherTeamIds,
        category: 'trades',
        title: 'Trade Declined',
        body: `${myTeamName} has declined the trade proposal.`,
        data: { screen: 'trades' },
      });

      capture('trade_rejected');
      postUpdate('rejected', myTeamName);
      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to reject trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }
    setProcessing(true);
    try {
      await supabase
        .from('trade_proposals')
        .update({ status: 'cancelled' })
        .eq('id', proposal.id);

      const otherTeamIds = proposal.teams
        .filter((t) => t.team_id !== teamId)
        .map((t) => t.team_id);

      sendNotification({
        league_id: leagueId,
        team_ids: otherTeamIds,
        category: 'trades',
        title: 'Trade Withdrawn',
        body: 'A trade proposal has been withdrawn.',
        data: { screen: 'trades' },
      });

      postUpdate('cancelled', myProposalTeam?.team_name ?? 'A team');
      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to cancel trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleCommissionerVeto = async () => {
    setProcessing(true);
    try {
      await supabase
        .from('trade_proposals')
        .update({ status: 'vetoed' })
        .eq('id', proposal.id);

      const involvedTeamIds = proposal.teams.map((t) => t.team_id);
      sendNotification({
        league_id: leagueId,
        team_ids: involvedTeamIds,
        category: 'trades',
        title: 'Trade Vetoed',
        body: 'The commissioner has vetoed a trade.',
        data: { screen: 'trades' },
      });

      postUpdate('vetoed', 'Commissioner');
      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to veto trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleCommissionerApprove = async () => {
    setProcessing(true);
    try {
      await supabase.functions.invoke('execute-trade', { body: { proposal_id: proposal.id } });
      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to approve trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleVoteToVeto = async () => {
    setProcessing(true);
    try {
      await supabase.from('trade_votes').insert({
        proposal_id: proposal.id,
        team_id: teamId,
        vote: 'veto',
      });

      const { count } = await supabase
        .from('trade_votes')
        .select('id', { count: 'exact', head: true })
        .eq('proposal_id', proposal.id)
        .eq('vote', 'veto');

      const threshold = leagueSettings?.trade_votes_to_veto ?? 4;
      if ((count ?? 0) >= threshold) {
        await supabase
          .from('trade_proposals')
          .update({ status: 'vetoed' })
          .eq('id', proposal.id);

        const involvedTeamIds = proposal.teams.map((t) => t.team_id);
        sendNotification({
          league_id: leagueId,
          team_ids: involvedTeamIds,
          category: 'trades',
          title: 'Trade Vetoed',
          body: 'The league has voted to veto a trade.',
          data: { screen: 'trades' },
        });

        postUpdate('vetoed', 'League Vote');
      }

      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to submit vote');
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmitDrop = async () => {
    if (selectedDropPlayerIds.length === 0) return;
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }
    setProcessing(true);
    try {
      await supabase
        .from('trade_proposal_teams')
        .update({ drop_player_ids: selectedDropPlayerIds })
        .eq('proposal_id', proposal.id)
        .eq('team_id', teamId);

      // Let the server determine if all drops are satisfied — it checks actual
      // roster counts, not just net gain, so it handles teams with spare room correctly.
      await supabase.functions.invoke('execute-trade', { body: { proposal_id: proposal.id } });

      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to submit roster drop');
    } finally {
      setProcessing(false);
    }
  };

  return {
    processing,
    handleAccept,
    handleReject,
    handleCancel,
    handleCommissionerVeto,
    handleCommissionerApprove,
    handleVoteToVeto,
    handleSubmitDrop,
  };
}
