import { TradeFairnessBar } from '@/components/trade/TradeFairnessBar';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { TradeProposalRow, useTradeVotes } from '@/hooks/useTrades';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { estimatePickFpts, formatPickLabel } from '@/types/trade';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { isOnline } from '@/utils/network';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface TradeDetailModalProps {
  proposal: TradeProposalRow;
  leagueId: string;
  teamId: string;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f0ad4e',
  accepted: '#007AFF',
  in_review: '#007AFF',
  completed: '#28a745',
  rejected: '#dc3545',
  cancelled: '#6c757d',
  vetoed: '#dc3545',
  reversed: '#6c757d',
};

export function TradeDetailModal({ proposal, leagueId, teamId, onClose }: TradeDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [processing, setProcessing] = useState(false);

  const { data: votes } = useTradeVotes(
    proposal.status === 'in_review' ? proposal.id : null
  );

  // Get league settings for veto info
  const { data: leagueSettings } = useQuery({
    queryKey: ['leagueTradeSettings', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('trade_veto_type, trade_review_period_hours, trade_votes_to_veto, teams')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  // Check if current user is commissioner
  const { data: isCommissioner } = useQuery({
    queryKey: ['isCommissioner', teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('is_commissioner')
        .eq('id', teamId)
        .single();
      if (error) throw error;
      return data?.is_commissioner ?? false;
    },
    enabled: !!teamId,
  });

  // Fetch player season stats for fairness calculation
  const playerIds = proposal.items
    .filter((i) => i.player_id)
    .map((i) => i.player_id!);
  const { data: playerStats } = useQuery({
    queryKey: ['tradePlayerStats', playerIds],
    queryFn: async () => {
      if (playerIds.length === 0) return [];
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: playerIds.length > 0,
  });

  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const myProposalTeam = proposal.teams.find((t) => t.team_id === teamId);
  const isProposer = proposal.proposed_by_team_id === teamId;
  const isInvolved = !!myProposalTeam;
  const myTeamStatus = myProposalTeam?.status;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tradeProposals', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });
    queryClient.invalidateQueries({ queryKey: ['tradeVotes', proposal.id] });
  };

  // Compute fairness
  const fairness = computeDetailFairness(proposal, playerStats, scoringWeights);

  // --- Actions ---
  const handleAccept = async () => {
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }
    setProcessing(true);
    try {
      // Update my team's status
      await supabase
        .from('trade_proposal_teams')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('proposal_id', proposal.id)
        .eq('team_id', teamId);

      // Check if all teams have now accepted
      const { data: allTeams } = await supabase
        .from('trade_proposal_teams')
        .select('status')
        .eq('proposal_id', proposal.id);

      const allAccepted = (allTeams ?? []).every((t) => t.status === 'accepted');

      const myTeamName = myProposalTeam?.team_name ?? 'A team';
      const otherTeamIds = proposal.teams
        .filter((t) => t.team_id !== teamId)
        .map((t) => t.team_id);

      if (allAccepted) {
        const vetoType = leagueSettings?.trade_veto_type ?? 'commissioner';
        if (vetoType === 'none') {
          // Execute immediately — execute-trade edge function sends its own notifications
          await supabase.functions.invoke('execute-trade', { body: { proposal_id: proposal.id } });
        } else {
          // Move to review
          const reviewHours = leagueSettings?.trade_review_period_hours ?? 24;
          const expiresAt = new Date(Date.now() + reviewHours * 3600000).toISOString();
          await supabase
            .from('trade_proposals')
            .update({
              status: 'in_review',
              accepted_at: new Date().toISOString(),
              review_expires_at: expiresAt,
            })
            .eq('id', proposal.id);

          // Notify league that a trade is in review
          sendNotification({
            league_id: leagueId,
            category: 'trades',
            title: 'Trade Under Review',
            body: 'A trade has been accepted and is now under review.',
            data: { screen: 'trades' },
          });
        }
      } else {
        // Notify proposer that this team accepted
        sendNotification({
          league_id: leagueId,
          team_ids: [proposal.proposed_by_team_id],
          category: 'trades',
          title: 'Trade Accepted',
          body: `${myTeamName} has accepted your trade proposal.`,
          data: { screen: 'trades' },
        });
      }

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

      // Check if threshold is met
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
      }

      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to submit vote');
    } finally {
      setProcessing(false);
    }
  };

  // Build team name map
  const teamNameMap: Record<string, string> = {};
  proposal.teams.forEach((t) => { teamNameMap[t.team_id] = t.team_name; });

  // Group items by from_team
  const groupedByFrom: Record<string, typeof proposal.items> = {};
  for (const item of proposal.items) {
    const key = item.from_team_id;
    if (!groupedByFrom[key]) groupedByFrom[key] = [];
    groupedByFrom[key].push(item);
  }

  // Review countdown
  let reviewCountdown = '';
  if (proposal.status === 'in_review' && proposal.review_expires_at) {
    const remaining = new Date(proposal.review_expires_at).getTime() - Date.now();
    if (remaining > 0) {
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      reviewCountdown = `Completes in ${hrs}h ${mins}m`;
    } else {
      reviewCountdown = 'Review period expired';
    }
  }

  const vetoCount = (votes ?? []).filter((v: any) => v.vote === 'veto').length;
  const hasVoted = (votes ?? []).some((v: any) => v.team_id === teamId);
  const statusColor = STATUS_COLORS[proposal.status] ?? c.secondaryText;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }]} accessibilityViewIsModal={true}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View>
              <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>Trade Details</ThemedText>
              <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                <ThemedText style={styles.statusText}>{proposal.status.replace('_', ' ')}</ThemedText>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close trade details">
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {/* Trade details by team */}
            {Object.entries(groupedByFrom).map(([fromTeamId, items]) => (
              <View key={fromTeamId} style={[styles.section, { borderColor: c.border }]}>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>
                  {teamNameMap[fromTeamId] ?? 'Unknown'} sends:
                </ThemedText>
                {items.map((item) => (
                  <ThemedText key={item.id} style={styles.itemText}>
                    {item.player_name
                      ? `${item.player_name} (${item.player_position})`
                      : item.pick_swap_season
                        ? `${item.pick_swap_season} Rd ${item.pick_swap_round} swap — ${teamNameMap[item.to_team_id] ?? '?'} gets better pick`
                        : item.pick_season
                          ? `${formatPickLabel(item.pick_season!, item.pick_round!)}${item.protection_threshold ? ` [Top-${item.protection_threshold} protected]` : ''}${item.pick_original_team_name ? ` (via ${item.pick_original_team_name})` : ''}`
                          : 'Unknown'}
                    {!item.pick_swap_season && ` → ${teamNameMap[item.to_team_id] ?? 'Unknown'}`}
                  </ThemedText>
                ))}
              </View>
            ))}

            {/* Fairness */}
            {fairness.length > 0 && (
              <View style={styles.fairnessWrap}>
                <TradeFairnessBar teams={fairness} />
              </View>
            )}

            {/* Review info */}
            {proposal.status === 'in_review' && (
              <View style={[styles.reviewInfo, { backgroundColor: c.cardAlt }]}>
                <ThemedText style={[styles.reviewText, { color: c.secondaryText }]}>
                  {reviewCountdown}
                </ThemedText>
                {leagueSettings?.trade_veto_type === 'league_vote' && (
                  <ThemedText style={[styles.reviewText, { color: c.secondaryText }]}>
                    Veto votes: {vetoCount} / {leagueSettings.trade_votes_to_veto} needed
                  </ThemedText>
                )}
              </View>
            )}

            {/* Team acceptance statuses */}
            {proposal.status === 'pending' && (
              <View style={[styles.section, { borderColor: c.border }]}>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Responses</ThemedText>
                {proposal.teams.map((t) => (
                  <View key={t.team_id} style={styles.responseRow}>
                    <ThemedText>{t.team_name}</ThemedText>
                    <ThemedText style={{
                      color: t.status === 'accepted' ? '#28a745' : t.status === 'rejected' ? '#dc3545' : '#f0ad4e',
                      fontWeight: '600',
                    }}>
                      {t.status}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}

            {proposal.notes && (
              <View style={[styles.section, { borderColor: c.border }]}>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>Note</ThemedText>
                <ThemedText style={{ color: c.secondaryText }}>{proposal.notes}</ThemedText>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={[styles.actionRow, { borderTopColor: c.border }]}>
            {processing ? (
              <ActivityIndicator />
            ) : (
              <>
                {/* Pending: counterparty can accept/reject */}
                {proposal.status === 'pending' && isInvolved && !isProposer && myTeamStatus === 'pending' && (
                  <>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Accept trade"
                      style={[styles.actionBtn, { backgroundColor: '#28a745' }]}
                      onPress={() => Alert.alert('Accept Trade', 'Accept this trade?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Accept', onPress: handleAccept },
                      ])}
                    >
                      <ThemedText style={styles.actionBtnText}>Accept</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Decline trade"
                      style={[styles.actionBtn, { backgroundColor: '#dc3545' }]}
                      onPress={() => Alert.alert('Decline Trade', 'Decline this trade?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Decline', style: 'destructive', onPress: handleReject },
                      ])}
                    >
                      <ThemedText style={styles.actionBtnText}>Decline</ThemedText>
                    </TouchableOpacity>
                  </>
                )}

                {/* Pending: proposer can cancel */}
                {proposal.status === 'pending' && isProposer && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Cancel trade"
                    style={[styles.actionBtn, { backgroundColor: '#6c757d' }]}
                    onPress={() => Alert.alert('Cancel Trade', 'Withdraw this trade proposal?', [
                      { text: 'No', style: 'cancel' },
                      { text: 'Withdraw', style: 'destructive', onPress: handleCancel },
                    ])}
                  >
                    <ThemedText style={styles.actionBtnText}>Cancel Trade</ThemedText>
                  </TouchableOpacity>
                )}

                {/* In review: commissioner actions */}
                {proposal.status === 'in_review' && isCommissioner && leagueSettings?.trade_veto_type === 'commissioner' && (
                  <>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Approve trade"
                      style={[styles.actionBtn, { backgroundColor: '#28a745' }]}
                      onPress={() => Alert.alert('Approve Trade', 'Approve and execute this trade now?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Approve', onPress: handleCommissionerApprove },
                      ])}
                    >
                      <ThemedText style={styles.actionBtnText}>Approve</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Veto trade"
                      style={[styles.actionBtn, { backgroundColor: '#dc3545' }]}
                      onPress={() => Alert.alert('Veto Trade', 'Veto this trade?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Veto', style: 'destructive', onPress: handleCommissionerVeto },
                      ])}
                    >
                      <ThemedText style={styles.actionBtnText}>Veto</ThemedText>
                    </TouchableOpacity>
                  </>
                )}

                {/* In review: league vote */}
                {proposal.status === 'in_review' && leagueSettings?.trade_veto_type === 'league_vote' && !isInvolved && !hasVoted && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Vote to veto trade"
                    style={[styles.actionBtn, { backgroundColor: '#dc3545' }]}
                    onPress={() => Alert.alert('Vote to Veto', 'Cast a veto vote on this trade?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Veto', style: 'destructive', onPress: handleVoteToVeto },
                    ])}
                  >
                    <ThemedText style={styles.actionBtnText}>Vote to Veto</ThemedText>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function computeDetailFairness(
  proposal: TradeProposalRow,
  playerStats: any[] | undefined,
  scoringWeights: any[] | undefined
): Array<{ teamName: string; netFpts: number }> {
  if (!scoringWeights) return [];

  const teamNameMap: Record<string, string> = {};
  proposal.teams.forEach((t) => { teamNameMap[t.team_id] = t.team_name; });

  const playerFptsMap: Record<string, number> = {};
  if (playerStats) {
    for (const ps of playerStats) {
      playerFptsMap[ps.player_id] = calculateAvgFantasyPoints(ps, scoringWeights);
    }
  }

  // Net FPTS per team
  const net: Record<string, number> = {};
  for (const t of proposal.teams) {
    net[t.team_id] = 0;
  }

  for (const item of proposal.items) {
    let value = 0;
    if (item.player_id) {
      value = playerFptsMap[item.player_id] ?? 0;
    } else if (item.pick_round) {
      value = estimatePickFpts(item.pick_round);
    }

    if (net[item.from_team_id] !== undefined) net[item.from_team_id] -= value;
    if (net[item.to_team_id] !== undefined) net[item.to_team_id] += value;
  }

  return Object.entries(net).map(([tid, fpts]) => ({
    teamName: teamNameMap[tid] ?? 'Unknown',
    netFpts: fpts,
  }));
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '85%',
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    marginBottom: 6,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  closeText: {
    fontSize: 18,
    padding: 4,
  },
  content: {
    padding: 16,
    paddingBottom: 8,
  },
  section: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    marginBottom: 6,
  },
  itemText: {
    fontSize: 14,
    paddingVertical: 3,
  },
  fairnessWrap: {
    marginBottom: 12,
  },
  reviewInfo: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  reviewText: {
    fontSize: 13,
    marginBottom: 4,
  },
  responseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
