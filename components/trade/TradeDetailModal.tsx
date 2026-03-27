import { capture } from '@/lib/posthog';
import { TradeFairnessBar } from '@/components/trade/TradeFairnessBar';
import { RumorBubble } from '@/components/chat/RumorBubble';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useToast } from '@/context/ToastProvider';
import { RUMOR_TEMPLATES, useCanLeak, useLeakRumor } from '@/hooks/chat/useLeakRumor';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { TradeItemRow, TradeProposalRow, useTradeVotes } from '@/hooks/useTrades';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { estimatePickFpts, formatPickLabel } from '@/types/trade';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { getPlayerHeadshotUrl } from '@/utils/playerHeadshot';
import { isOnline } from '@/utils/network';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

function itemKey(item: TradeItemRow): string {
  if (item.player_id) return `p:${item.player_id}:${item.from_team_id}:${item.to_team_id}`;
  if (item.pick_swap_season) return `sw:${item.pick_swap_season}:${item.pick_swap_round}:${item.from_team_id}`;
  if (item.draft_pick_id) return `pk:${item.draft_pick_id}:${item.from_team_id}:${item.to_team_id}`;
  return item.id;
}

function getNewItemKeys(items: TradeItemRow[], originalItems?: TradeItemRow[]): Set<string> {
  if (!originalItems) return new Set();
  const origKeys = new Set(originalItems.map(itemKey));
  const newKeys = new Set<string>();
  for (const item of items) {
    const key = itemKey(item);
    if (!origKeys.has(key)) newKeys.add(key);
  }
  return newKeys;
}

interface TradeDetailModalProps {
  proposal: TradeProposalRow;
  leagueId: string;
  teamId: string;
  onClose: () => void;
  onCounteroffer?: (proposal: TradeProposalRow) => void;
  onEdit?: (proposal: TradeProposalRow) => void;
}

function getStatusColors(c: typeof Colors['light']): Record<string, string> {
  return {
    pending: c.warning,
    accepted: c.link,
    in_review: c.link,
    pending_drops: c.warning,
    completed: c.success,
    rejected: c.danger,
    cancelled: c.secondaryText,
    vetoed: c.danger,
    reversed: c.secondaryText,
  };
}

export function TradeDetailModal({ proposal, leagueId, teamId, onClose, onCounteroffer, onEdit }: TradeDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [showLeakSheet, setShowLeakSheet] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);
  const [selectedDropPlayerId, setSelectedDropPlayerId] = useState<string | null>(null);

  // Check if this proposal is part of a counteroffer chain (eligible for leak)
  const isTerminal = proposal.status === 'completed' || proposal.status === 'rejected' || proposal.status === 'cancelled' || proposal.status === 'vetoed' || proposal.status === 'reversed';
  const isInCounterofferChain = !isTerminal && (!!proposal.counteroffer_of ||
    proposal.status === 'pending' || proposal.status === 'accepted');
  const { data: canLeak } = useCanLeak(
    isInCounterofferChain && proposal.counteroffer_of ? proposal.id : null,
    leagueId,
  );

  const { data: votes } = useTradeVotes(
    proposal.status === 'in_review' ? proposal.id : null
  );

  // Get league settings for veto info + roster_size
  const { data: leagueSettings } = useQuery({
    queryKey: ['leagueTradeSettings', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('trade_veto_type, trade_review_period_hours, trade_votes_to_veto, teams, roster_size')
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

  // Trade is editable if proposer and no other team has responded yet
  const isEditable = proposal.status === 'pending' && isProposer && onEdit &&
    proposal.teams.filter((t) => t.team_id !== teamId).every((t) => t.status === 'pending');

  // Compute net player gain for my team
  const myNetGain = proposal.items.reduce((acc, item) => {
    if (!item.player_id) return acc;
    if (item.to_team_id === teamId) return acc + 1;
    if (item.from_team_id === teamId) return acc - 1;
    return acc;
  }, 0);

  // Check if my team needs to select a drop (for pending_drops status)
  const needsMyDrop = proposal.status === 'pending_drops' && isInvolved && myNetGain > 0;

  // Proactively check if accepting would exceed roster limit (shown as warning before user taps Accept)
  const { data: wouldExceedRoster } = useQuery<boolean>({
    queryKey: ['tradeRosterCheck', teamId, leagueId, proposal.id],
    queryFn: async () => {
      const rosterSize = leagueSettings?.roster_size ?? 13;
      const [allRes, irRes] = await Promise.all([
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId),
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId).eq('roster_slot', 'IR'),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      return activeCount + myNetGain > rosterSize;
    },
    enabled: proposal.status === 'pending' && isInvolved && !isProposer && myNetGain > 0 && !!leagueSettings,
    staleTime: 1000 * 30,
  });

  // Fetch my team's roster for the drop picker
  const { data: myRoster } = useQuery<(PlayerSeasonStats & { roster_slot: string | null })[]>({
    queryKey: ['dropPickerRoster', teamId, leagueId],
    queryFn: async () => {
      const { data: lps, error: lpErr } = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('team_id', teamId)
        .eq('league_id', leagueId);
      if (lpErr) throw lpErr;
      if (!lps || lps.length === 0) return [];
      const ids = lps.map((lp) => lp.player_id);
      const slotMap = new Map(lps.map((lp) => [lp.player_id, lp.roster_slot]));
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', ids);
      if (error) throw error;
      // Exclude players being traded away and IR players
      const tradedAwayIds = new Set(
        proposal.items.filter((i) => i.player_id && i.from_team_id === teamId).map((i) => i.player_id!),
      );
      return (data ?? [])
        .map((p) => ({ ...p, roster_slot: slotMap.get(p.player_id) ?? null }))
        .filter((p) => !tradedAwayIds.has(p.player_id) && p.roster_slot !== 'IR')
        .sort((a, b) => {
          // Bench first, then others
          const aIsBench = a.roster_slot === 'BE' || a.roster_slot === 'TAXI' ? 0 : 1;
          const bIsBench = b.roster_slot === 'BE' || b.roster_slot === 'TAXI' ? 0 : 1;
          return aIsBench - bIsBench;
        });
    },
    enabled: showDropPicker || needsMyDrop,
  });

  // Fetch drop status for all teams in pending_drops
  const { data: proposalTeamDrops } = useQuery({
    queryKey: ['proposalTeamDrops', proposal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_proposal_teams')
        .select('team_id, drop_player_id')
        .eq('proposal_id', proposal.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: proposal.status === 'pending_drops',
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tradeProposals', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });
    queryClient.invalidateQueries({ queryKey: ['tradeVotes', proposal.id] });
    queryClient.invalidateQueries({ queryKey: ['tradeBlock', leagueId] });
  };

  // Compute fairness
  const fairness = computeDetailFairness(proposal, playerStats, scoringWeights);

  // --- Actions ---
  const handleAccept = async () => {
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }

    // If my team gains players, check if we'd go over the roster limit
    if (myNetGain > 0 && !selectedDropPlayerId) {
      const rosterSize = leagueSettings?.roster_size ?? 13;
      const [allRes, irRes] = await Promise.all([
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId),
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId).eq('roster_slot', 'IR'),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      if (activeCount + myNetGain > rosterSize) {
        setShowDropPicker(true);
        return;
      }
    }

    setProcessing(true);
    try {
      // Store drop selection if one was made
      if (selectedDropPlayerId) {
        await supabase
          .from('trade_proposal_teams')
          .update({ drop_player_id: selectedDropPlayerId })
          .eq('proposal_id', proposal.id)
          .eq('team_id', teamId);
      }

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
          // Mark proposal as accepted, then execute immediately
          await supabase
            .from('trade_proposals')
            .update({ status: 'accepted', accepted_at: new Date().toISOString() })
            .eq('id', proposal.id);
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

      capture('trade_accepted');

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

  // Submit a drop selection for pending_drops status
  const handleSubmitDrop = async () => {
    if (!selectedDropPlayerId) return;
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }
    setProcessing(true);
    try {
      await supabase
        .from('trade_proposal_teams')
        .update({ drop_player_id: selectedDropPlayerId })
        .eq('proposal_id', proposal.id)
        .eq('team_id', teamId);

      // Check if all teams that need drops have now selected one
      const { data: updatedTeams } = await supabase
        .from('trade_proposal_teams')
        .select('team_id, drop_player_id')
        .eq('proposal_id', proposal.id);

      // Recompute which teams need drops
      const netByTeam = new Map<string, number>();
      for (const item of proposal.items) {
        if (!item.player_id) continue;
        netByTeam.set(item.from_team_id, (netByTeam.get(item.from_team_id) ?? 0) - 1);
        netByTeam.set(item.to_team_id, (netByTeam.get(item.to_team_id) ?? 0) + 1);
      }
      const teamsNeedingDrops = [...netByTeam.entries()].filter(([, gain]) => gain > 0).map(([tid]) => tid);
      const allDropsSet = teamsNeedingDrops.every((tid) =>
        (updatedTeams ?? []).find((t) => t.team_id === tid)?.drop_player_id,
      );

      if (allDropsSet) {
        // All drops selected — execute the trade
        await supabase.functions.invoke('execute-trade', { body: { proposal_id: proposal.id } });
      }

      invalidate();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to submit roster drop');
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
  const STATUS_COLORS = getStatusColors(c);
  const statusColor = STATUS_COLORS[proposal.status] ?? c.secondaryText;
  const isCounteroffer = !!proposal.counteroffer_of;
  const newItemKeys = getNewItemKeys(proposal.items, proposal.original_items);

  // Players available for leak (only actual players, not picks)
  const leakPlayers = proposal.items
    .filter((i) => i.player_id && i.player_name)
    .map((i) => ({ id: i.player_id!, name: i.player_name!, position: i.player_position ?? '' }));

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }, showLeakSheet && styles.sheetExpanded]} accessibilityViewIsModal={true}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View>
              <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
                {showLeakSheet ? 'Leak to League Chat' : 'Trade Details'}
              </ThemedText>
              {!showLeakSheet && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                    <ThemedText style={[styles.statusText, { color: c.statusText }]}>{proposal.status.replace('_', ' ')}</ThemedText>
                  </View>
                  {isCounteroffer && (
                    <View style={[styles.statusBadge, { backgroundColor: c.warning }]}>
                      <ThemedText style={[styles.statusText, { color: c.statusText }]}>counteroffer</ThemedText>
                    </View>
                  )}
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => showLeakSheet ? setShowLeakSheet(false) : onClose()}
              accessibilityRole="button"
              accessibilityLabel={showLeakSheet ? 'Back to trade details' : 'Close trade details'}
            >
              <ThemedText style={styles.closeText}>{showLeakSheet ? '←' : '✕'}</ThemedText>
            </TouchableOpacity>
          </View>

          {showLeakSheet ? (
            <LeakRumorInline
              proposalId={proposal.id}
              leagueId={leagueId}
              teamId={teamId}
              players={leakPlayers}
              onDone={() => { setShowLeakSheet(false); }}
            />
          ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {/* Trade details by team */}
            {Object.entries(groupedByFrom).map(([fromTeamId, items]) => (
              <View key={fromTeamId} style={[styles.section, { borderColor: c.border }]}>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>
                  {teamNameMap[fromTeamId] ?? 'Unknown'} sends:
                </ThemedText>
                {items.map((item) => {
                  const isNew = newItemKeys.has(itemKey(item));
                  return (
                    <View key={item.id} style={styles.itemRow}>
                      <ThemedText style={[styles.itemText, { flex: 1 }]}>
                        {item.player_name
                          ? `${item.player_name} (${item.player_position})`
                          : item.pick_swap_season
                            ? `${formatPickLabel(item.pick_swap_season!, item.pick_swap_round!)} swap — ${teamNameMap[item.to_team_id] ?? '?'} gets better pick`
                            : item.pick_season
                              ? `${formatPickLabel(item.pick_season!, item.pick_round!)}${item.protection_threshold ? ` [Top-${item.protection_threshold} protected]` : ''}${item.pick_original_team_name ? ` (via ${item.pick_original_team_name})` : ''}`
                              : 'Unknown'}
                        {!item.pick_swap_season && ` → ${teamNameMap[item.to_team_id] ?? 'Unknown'}`}
                      </ThemedText>
                      {isNew && (
                        <View style={[styles.newBadge, { backgroundColor: c.link }]} accessibilityLabel="Newly added in counteroffer">
                          <Text style={[styles.newBadgeText, { color: c.statusText }]}>NEW</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
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

            {/* Roster capacity warning — shown before user taps Accept */}
            {wouldExceedRoster && !showDropPicker && (
              <View
                accessibilityRole="alert"
                style={[styles.rosterWarning, { backgroundColor: c.warningMuted, borderColor: c.warning }]}
              >
                <ThemedText style={{ fontSize: 13, color: c.warning, fontWeight: '600' }}>
                  Accepting this trade would exceed your roster limit. You'll need to select a player to drop.
                </ThemedText>
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
                      color: t.status === 'accepted' ? c.success : t.status === 'rejected' ? c.danger : c.warning,
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

            {/* Pending drops — waiting on other teams */}
            {proposal.status === 'pending_drops' && !needsMyDrop && (
              <View style={[styles.reviewInfo, { backgroundColor: c.cardAlt }]}>
                <ThemedText style={[styles.reviewText, { color: c.secondaryText }]}>
                  Waiting for roster drops before this trade can complete.
                </ThemedText>
              </View>
            )}

            {/* Drop picker — inline for accept flow or pending_drops */}
            {(showDropPicker || needsMyDrop) && (
              <View style={[styles.section, { borderColor: c.border }]}>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.sectionTitle}>
                  Select a player to drop
                </ThemedText>
                <ThemedText style={[{ color: c.secondaryText, fontSize: 12, marginBottom: 8 }]}>
                  This trade would put you over the roster limit. Choose a player to release.
                </ThemedText>
                {(myRoster ?? []).map((p) => {
                  const isDropSelected = selectedDropPlayerId === p.player_id;
                  const headshotUrl = getPlayerHeadshotUrl(p.external_id_nba);
                  return (
                    <TouchableOpacity
                      key={p.player_id}
                      accessibilityRole="radio"
                      accessibilityLabel={`${p.name}, ${p.position}${p.roster_slot ? `, ${p.roster_slot}` : ''}`}
                      accessibilityState={{ selected: isDropSelected }}
                      style={[
                        styles.dropRow,
                        { borderBottomColor: c.border },
                        isDropSelected && { backgroundColor: c.activeCard },
                      ]}
                      onPress={() => setSelectedDropPlayerId(isDropSelected ? null : p.player_id)}
                    >
                      <View style={[styles.dropHeadshot, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                        {headshotUrl ? (
                          <Image source={{ uri: headshotUrl }} style={styles.dropHeadshotImg} resizeMode="cover" />
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="defaultSemiBold" style={{ fontSize: 14 }} numberOfLines={1}>
                          {p.name}
                        </ThemedText>
                        <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
                          {p.position} · {p.roster_slot ?? 'BE'}
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.check, { color: c.success }]}>{isDropSelected ? '✓' : ''}</ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          )}

          {/* Action Buttons */}
          {!showLeakSheet && (
          <View style={[styles.actionArea, { borderTopColor: c.border }]}>
            {processing ? (
              <ActivityIndicator />
            ) : (
              <>
                {/* Pending: counterparty can accept/reject (or accept & drop if roster is full) */}
                {proposal.status === 'pending' && isInvolved && !isProposer && myTeamStatus === 'pending' && (
                  <View style={styles.actionRow}>
                    {showDropPicker ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Accept trade and drop selected player"
                        style={[styles.actionBtn, { backgroundColor: selectedDropPlayerId ? c.success : c.secondaryText }]}
                        disabled={!selectedDropPlayerId}
                        onPress={() => Alert.alert(
                          'Accept Trade',
                          'Accept this trade and drop the selected player?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Accept', onPress: handleAccept },
                          ],
                        )}
                      >
                        <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Accept & Drop</ThemedText>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Accept trade"
                        style={[styles.actionBtn, { backgroundColor: c.success }]}
                        onPress={() => Alert.alert('Accept Trade', 'Accept this trade?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Accept', onPress: handleAccept },
                        ])}
                      >
                        <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Accept</ThemedText>
                      </TouchableOpacity>
                    )}
                    {onCounteroffer && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Counteroffer trade"
                        style={[styles.actionBtn, { backgroundColor: c.warning }]}
                        onPress={() => onCounteroffer(proposal)}
                      >
                        <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Counter</ThemedText>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Decline trade"
                      style={[styles.actionBtn, { backgroundColor: c.danger }]}
                      onPress={() => Alert.alert('Decline Trade', 'Decline this trade?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Decline', style: 'destructive', onPress: handleReject },
                      ])}
                    >
                      <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Decline</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Pending drops: my team needs to select a drop */}
                {needsMyDrop && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Confirm player drop to complete trade"
                      style={[styles.actionBtn, { backgroundColor: selectedDropPlayerId ? c.success : c.secondaryText }]}
                      disabled={!selectedDropPlayerId}
                      onPress={() => Alert.alert(
                        'Confirm Drop',
                        'Drop the selected player and complete the trade?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Confirm', onPress: handleSubmitDrop },
                        ],
                      )}
                    >
                      <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Confirm Drop</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Pending: proposer can edit (if untouched) and cancel, or teams that already accepted can back out */}
                {proposal.status === 'pending' && isInvolved && (isProposer || myTeamStatus === 'accepted') && (
                  <View style={styles.actionRow}>
                    {isEditable && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Edit trade"
                        style={[styles.actionBtn, { backgroundColor: c.link }]}
                        onPress={() => onEdit!(proposal)}
                      >
                        <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Edit</ThemedText>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={isProposer ? 'Cancel trade' : 'Back out of trade'}
                      style={[styles.actionBtn, { backgroundColor: c.secondaryText }]}
                      onPress={() => Alert.alert(
                        isProposer ? 'Cancel Trade' : 'Back Out',
                        isProposer
                          ? 'Withdraw this trade proposal?'
                          : 'Back out and cancel this trade for all parties?',
                        [
                          { text: 'No', style: 'cancel' },
                          { text: isProposer ? 'Withdraw' : 'Back Out', style: 'destructive', onPress: handleCancel },
                        ]
                      )}
                    >
                      <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>
                        {isProposer ? 'Cancel Trade' : 'Back Out'}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* In review: commissioner can always approve/veto regardless of veto type */}
                {proposal.status === 'in_review' && isCommissioner && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Approve trade"
                      style={[styles.actionBtn, { backgroundColor: c.success }]}
                      onPress={() => Alert.alert('Approve Trade', 'Approve and execute this trade now?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Approve', onPress: handleCommissionerApprove },
                      ])}
                    >
                      <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Approve</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Veto trade"
                      style={[styles.actionBtn, { backgroundColor: c.danger }]}
                      onPress={() => Alert.alert('Veto Trade', 'Veto this trade?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Veto', style: 'destructive', onPress: handleCommissionerVeto },
                      ])}
                    >
                      <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Veto</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* In review: league vote (non-commissioner members) */}
                {proposal.status === 'in_review' && leagueSettings?.trade_veto_type === 'league_vote' && !isCommissioner && !isInvolved && !hasVoted && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Vote to veto trade"
                      style={[styles.actionBtn, { backgroundColor: c.danger }]}
                      onPress={() => Alert.alert('Vote to Veto', 'Cast a veto vote on this trade?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Veto', style: 'destructive', onPress: handleVoteToVeto },
                      ])}
                    >
                      <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Vote to Veto</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Already voted indicator */}
                {proposal.status === 'in_review' && leagueSettings?.trade_veto_type === 'league_vote' && !isCommissioner && hasVoted && (
                  <View style={styles.actionRow}>
                    <View style={[styles.actionBtn, { backgroundColor: c.cardAlt }]} accessibilityLabel="You voted to veto this trade">
                      <ThemedText style={[styles.votedText, { color: c.secondaryText }]}>You voted to veto</ThemedText>
                    </View>
                  </View>
                )}

                {/* Leak button — visible for counteroffer chains */}
                {canLeak && !isTerminal && isInvolved && proposal.counteroffer_of && leakPlayers.length > 0 && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Leak trade negotiations to league chat"
                      style={[styles.actionBtn, { backgroundColor: c.warning }]}
                      onPress={() => setShowLeakSheet(true)}
                    >
                      <Text style={[styles.actionBtnText, { color: c.statusText }]}>Leak to Chat</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function LeakRumorInline({
  proposalId, leagueId, teamId, players, onDone,
}: {
  proposalId: string;
  leagueId: string;
  teamId: string;
  players: Array<{ id: string; name: string; position: string }>;
  onDone: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();
  const leak = useLeakRumor();
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<number>(0);

  const selectedPlayerObj = players.find((p) => p.id === selectedPlayer);
  const previewText = selectedPlayerObj
    ? RUMOR_TEMPLATES[selectedTemplate].replace('{player}', selectedPlayerObj.name)
    : RUMOR_TEMPLATES[selectedTemplate].replace('{player}', '______');

  const handleLeak = async () => {
    if (!selectedPlayer || !selectedPlayerObj) return;
    try {
      await leak.mutateAsync({
        proposalId,
        leagueId,
        teamId,
        playerId: selectedPlayer,
        playerName: selectedPlayerObj.name,
        template: RUMOR_TEMPLATES[selectedTemplate],
      });
      showToast('success', 'Rumor leaked to league chat');
      onDone();
    } catch (err: any) {
      const msg = err.message ?? '';
      if (msg.includes('idx_trade_rumors_manual') || msg.includes('duplicate key') || msg.includes('unique constraint')) {
        showToast('error', 'This trade negotiation has already been leaked');
        onDone();
        return;
      }
      showToast('error', msg || 'Failed to leak rumor');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.leakContent} style={{ flex: 1 }}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Select player</ThemedText>
        <View style={styles.chipRow}>
          {players.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.chip,
                {
                  backgroundColor: selectedPlayer === p.id ? c.accent : c.cardAlt,
                  borderColor: selectedPlayer === p.id ? c.accent : c.border,
                },
              ]}
              onPress={() => setSelectedPlayer(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedPlayer === p.id }}
              accessibilityLabel={`${p.name}, ${p.position}`}
            >
              <ThemedText
                style={{ fontSize: 14, fontWeight: '500', color: selectedPlayer === p.id ? c.statusText : c.text }}
              >
                {p.name} ({p.position})
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        <ThemedText type="defaultSemiBold" style={[styles.sectionTitle, { marginTop: 16 }]}>
          Choose message
        </ThemedText>
        {RUMOR_TEMPLATES.map((tmpl, i) => {
          const display = selectedPlayerObj
            ? tmpl.replace('{player}', selectedPlayerObj.name)
            : tmpl.replace('{player}', '______');
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.templateRow,
                {
                  backgroundColor: selectedTemplate === i ? c.activeCard : c.cardAlt,
                  borderColor: selectedTemplate === i ? c.activeBorder : c.border,
                },
              ]}
              onPress={() => setSelectedTemplate(i)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedTemplate === i }}
              accessibilityLabel={display}
            >
              <ThemedText style={{ fontSize: 14, lineHeight: 20, fontStyle: 'italic' }}>
                &ldquo;{display}&rdquo;
              </ThemedText>
            </TouchableOpacity>
          );
        })}

        {/* Always show preview to prevent layout jump */}
        <View style={{ marginTop: 16 }}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Preview</ThemedText>
          <RumorBubble rumorText={previewText} />
        </View>
      </ScrollView>

      <View style={[styles.actionArea, styles.leakActionArea, { borderTopColor: c.border }]}>
        {leak.isPending ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: selectedPlayer ? c.warning : c.buttonDisabled },
              ]}
              onPress={handleLeak}
              disabled={!selectedPlayer || leak.isPending}
              accessibilityRole="button"
              accessibilityLabel="Leak rumor to league chat"
              accessibilityState={{ disabled: !selectedPlayer }}
            >
              <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Leak to Chat</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
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
  sheetExpanded: {
    flex: 1,
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  itemText: {
    fontSize: 14,
  },
  newBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    marginLeft: 8,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
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
  actionArea: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  votedText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  templateRow: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  leakContent: {
    padding: 16,
    paddingBottom: 24,
  },
  leakActionArea: {
    paddingBottom: 32,
  },
  rosterWarning: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  dropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropHeadshot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden' as const,
    marginRight: 8,
  },
  dropHeadshotImg: {
    position: 'absolute' as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: 30,
  },
  sub: {
    fontSize: 11,
    marginTop: 1,
  },
  check: {
    width: 22,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
