import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { DropPickerSection } from '@/components/trade/DropPickerSection';
import { LeakRumorSheet } from '@/components/trade/LeakRumorSheet';
import { TradeActionBar } from '@/components/trade/TradeActionBar';
import { TradeFairnessBar } from '@/components/trade/TradeFairnessBar';
import { TradeSideSummary } from '@/components/trade/TradeSideSummary';
import { TradeStatusTimeline } from '@/components/trade/TradeStatusTimeline';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useCanLeak } from '@/hooks/chat/useLeakRumor';
import { useGetTradeConversation } from '@/hooks/chat/useTradeChat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useTradeDetailActions } from '@/hooks/useTradeDetailActions';
import { TradeItemRow, TradeProposalRow, useTradeVotes } from '@/hooks/useTrades';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { estimatePickFpts } from '@/types/trade';
import { ms, s } from '@/utils/scale';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';

// ── Helpers ──────────────────────────────────────────────────────────────

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

function getStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
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

function computeFairness(
  proposal: TradeProposalRow,
  playerStats: PlayerSeasonStats[] | undefined,
  scoringWeights: any[] | undefined,
): { teamName: string; netFpts: number }[] {
  if (!scoringWeights) return [];

  const teamNameMap: Record<string, string> = {};
  proposal.teams.forEach((t) => { teamNameMap[t.team_id] = t.team_name; });

  const playerFptsMap: Record<string, number> = {};
  if (playerStats) {
    for (const ps of playerStats) {
      playerFptsMap[ps.player_id] = calculateAvgFantasyPoints(ps, scoringWeights);
    }
  }

  const net: Record<string, number> = {};
  for (const t of proposal.teams) { net[t.team_id] = 0; }

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

// ── Props ────────────────────────────────────────────────────────────────

interface TradeDetailModalProps {
  proposal: TradeProposalRow;
  leagueId: string;
  teamId: string;
  onClose: () => void;
  onCounteroffer?: (proposal: TradeProposalRow) => void;
  onEdit?: (proposal: TradeProposalRow) => void;
}

// ── Component ────────────────────────────────────────────────────────────

export function TradeDetailModal({ proposal, leagueId, teamId, onClose, onCounteroffer, onEdit }: TradeDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const router = useRouter();
  const [showLeakSheet, setShowLeakSheet] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);
  const [selectedDropPlayerIds, setSelectedDropPlayerIds] = useState<string[]>([]);

  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }),
    ]).start();
  }, []);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: Dimensions.get('window').height, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  // ── Derived state ──

  const teamNameMap: Record<string, string> = {};
  proposal.teams.forEach((t) => { teamNameMap[t.team_id] = t.team_name; });

  const isTerminal = ['completed', 'rejected', 'cancelled', 'vetoed', 'reversed'].includes(proposal.status);
  const isCounteroffer = !!proposal.counteroffer_of;
  const isInCounterofferChain = !isTerminal && (!!proposal.counteroffer_of || proposal.status === 'pending' || proposal.status === 'accepted');

  const myProposalTeam = proposal.teams.find((t) => t.team_id === teamId);
  const isProposer = proposal.proposed_by_team_id === teamId;
  const isInvolved = !!myProposalTeam;
  const myTeamStatus = myProposalTeam?.status;

  const isEditable = proposal.status === 'pending' && isProposer && !!onEdit &&
    proposal.teams.filter((t) => t.team_id !== teamId).every((t) => t.status === 'pending');

  const myNetGain = proposal.items.reduce((acc, item) => {
    if (!item.player_id) return acc;
    if (item.to_team_id === teamId) return acc + 1;
    if (item.from_team_id === teamId) return acc - 1;
    return acc;
  }, 0);

  const mySubmittedDropCount = myProposalTeam?.drop_player_ids?.length ?? 0;
  const newItemKeys = getNewItemKeys(proposal.items, proposal.original_items);

  // ── Data fetching ──

  const { data: canLeak } = useCanLeak(
    isInCounterofferChain && proposal.counteroffer_of ? proposal.id : null,
    leagueId,
  );

  const { data: votes } = useTradeVotes(
    proposal.status === 'in_review' ? proposal.id : null,
  );

  const { data: leagueSettings } = useQuery({
    queryKey: queryKeys.leagueTradeSettings(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('trade_veto_type, trade_review_period_hours, trade_votes_to_veto, teams, roster_size, scoring_type')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const { data: isCommissioner } = useQuery({
    queryKey: queryKeys.isCommissioner(teamId),
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

  const playerIds = proposal.items.filter((i) => i.player_id).map((i) => i.player_id!);

  const { data: playerStats } = useQuery({
    queryKey: queryKeys.tradePlayerStats(playerIds),
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

  // How many players must this team drop to accommodate the incoming players?
  const { data: dropsNeeded = 0 } = useQuery<number>({
    queryKey: queryKeys.tradeRosterCheck(teamId, leagueId, proposal.id),
    queryFn: async () => {
      const rosterSize = leagueSettings?.roster_size ?? 13;
      const [allRes, irRes] = await Promise.all([
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId),
        supabase.from('league_players').select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId).eq('team_id', teamId).eq('roster_slot', 'IR'),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      return Math.max(0, activeCount + myNetGain - rosterSize);
    },
    enabled: isInvolved && myNetGain > 0 && !!leagueSettings,
    staleTime: 1000 * 30,
  });
  const wouldExceedRoster = dropsNeeded > 0;

  // Drops picker appears while the proposal is blocked on drops AND I still
  // owe more than I've already submitted. If `dropsNeeded` is 0 it means I
  // have spare roster room and the server won't flag me — no picker needed,
  // even when `myNetGain > 0`. If I've already submitted enough drops, we
  // fall through to the "waiting on other teams" chip instead.
  const needsMyDrop = proposal.status === 'pending_drops' && isInvolved && dropsNeeded > mySubmittedDropCount;

  const { data: myRoster } = useQuery({
    queryKey: queryKeys.dropPickerRoster(teamId, leagueId, proposal.id),
    queryFn: async (): Promise<(PlayerSeasonStats & { roster_slot: string | null })[]> => {
      const [lpRes, lockedRes] = await Promise.all([
        supabase
          .from('league_players')
          .select('player_id, roster_slot')
          .eq('team_id', teamId)
          .eq('league_id', leagueId),
        // Any of MY players that are from_team_id in another active trade
        // proposal can't be safely dropped — dropping them would break the
        // other trade when it executes. Excludes the current proposal.
        supabase
          .from('trade_proposal_items')
          .select('player_id, trade_proposals!inner(id, status)')
          .eq('from_team_id', teamId)
          .neq('trade_proposals.id', proposal.id)
          .in('trade_proposals.status', ['pending', 'accepted', 'in_review', 'delayed', 'pending_drops'])
          .not('player_id', 'is', null),
      ]);
      if (lpRes.error) throw lpRes.error;
      if (lockedRes.error) throw lockedRes.error;
      const lps = lpRes.data;
      if (!lps || lps.length === 0) return [];
      const ids = lps.map((lp) => lp.player_id);
      const slotMap = new Map(lps.map((lp) => [lp.player_id, lp.roster_slot]));
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', ids);
      if (error) throw error;
      const tradedAwayIds = new Set(
        proposal.items.filter((i) => i.player_id && i.from_team_id === teamId).map((i) => i.player_id!),
      );
      const lockedInOtherTrades = new Set(
        (lockedRes.data ?? [])
          .map((r: any) => r.player_id as string | null)
          .filter((x): x is string => !!x),
      );
      return (data ?? [])
        .filter((p) => !!p.player_id)
        .map((p) => ({ ...p, roster_slot: slotMap.get(p.player_id!) ?? null }))
        .filter((p) =>
          !tradedAwayIds.has(p.player_id!)
          && !lockedInOtherTrades.has(p.player_id!)
          && p.roster_slot !== 'IR',
        )
        .sort((a, b) => {
          const aIsBench = a.roster_slot === 'BE' || a.roster_slot === 'TAXI' ? 0 : 1;
          const bIsBench = b.roster_slot === 'BE' || b.roster_slot === 'TAXI' ? 0 : 1;
          return aIsBench - bIsBench;
        }) as unknown as (PlayerSeasonStats & { roster_slot: string | null })[];
    },
    enabled: showDropPicker || needsMyDrop,
  });

  // ── Actions hook ──

  const actions = useTradeDetailActions({
    proposal,
    leagueId,
    teamId,
    leagueSettings,
    myNetGain,
    selectedDropPlayerIds,
    onClose,
  });

  // ── Computed display data ──

  const isCategories = leagueSettings?.scoring_type === 'h2h_categories';

  const playerFptsMap: Record<string, number> = {};
  const playerHeadshotMap: Record<string, string | null> = {};
  if (playerStats && scoringWeights && !isCategories) {
    for (const ps of playerStats) {
      if (!ps.player_id) continue;
      playerFptsMap[ps.player_id] = calculateAvgFantasyPoints(ps as PlayerSeasonStats, scoringWeights);
      playerHeadshotMap[ps.player_id] = ps.external_id_nba ?? null;
    }
  }

  // Group items by receiving team
  const receivedByTeam: Record<string, TradeItemRow[]> = {};
  for (const t of proposal.teams) { receivedByTeam[t.team_id] = []; }
  for (const item of proposal.items) {
    if (receivedByTeam[item.to_team_id]) {
      receivedByTeam[item.to_team_id].push(item);
    }
  }

  const fairness = computeFairness(proposal, playerStats as PlayerSeasonStats[] | undefined, scoringWeights);

  // Review countdown
  let reviewCountdown = '';
  if (proposal.status === 'in_review' && proposal.review_expires_at) {
    const remaining = new Date(proposal.review_expires_at).getTime() - Date.now();
    if (remaining > 0) {
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      reviewCountdown = `${hrs}h ${mins}m remaining`;
    } else {
      reviewCountdown = 'Review period expired';
    }
  }

  const vetoCount = (votes ?? []).filter((v: any) => v.vote === 'veto').length;
  const hasVoted = (votes ?? []).some((v: any) => v.team_id === teamId);
  const STATUS_COLORS = getStatusColors(c);
  const statusColor = STATUS_COLORS[proposal.status] ?? c.secondaryText;

  const leakPlayers = proposal.items
    .filter((i) => i.player_id && i.player_name)
    .map((i) => ({ id: i.player_id!, name: i.player_name!, position: i.player_position ?? '' }));

  const teamIds = proposal.teams.map((t) => t.team_id);
  const isTwoTeam = teamIds.length === 2;

  const getTradeChat = useGetTradeConversation(leagueId);
  const handleOpenChat = () => {
    getTradeChat.mutate(
      { proposalId: proposal.id, teamIds },
      {
        onSuccess: (conversationId) => {
          handleClose();
          setTimeout(() => router.push(`/chat/${conversationId}`), 300);
        },
      },
    );
  };

  // ── Render ──

  return (
    <Modal visible animationType="none" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.scrim, { opacity: fadeAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close trade details" />
        </Animated.View>
        <Animated.View style={[styles.sheet, { backgroundColor: c.background, transform: [{ translateY: slideAnim }] }, showLeakSheet && styles.sheetExpanded]} accessibilityViewIsModal>

          {/* ── Header ── */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerLeft}>
              {showLeakSheet ? (
                <TouchableOpacity
                  onPress={() => setShowLeakSheet(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to trade details"
                  hitSlop={12}
                >
                  <Ionicons name="arrow-back" size={22} color={c.text} />
                </TouchableOpacity>
              ) : null}
              <View>
                {showLeakSheet ? (
                  <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
                    Leak to Chat
                  </ThemedText>
                ) : (
                  <View style={styles.headerTitleRow}>
                    <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
                      Trade Details
                    </ThemedText>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                      <ThemedText style={[styles.statusText, { color: c.statusText }]}>
                        {getStatusLabel(proposal.status)}
                      </ThemedText>
                    </View>
                    {isCounteroffer && (
                      <View style={[styles.statusBadge, { backgroundColor: c.accent }]}>
                        <ThemedText style={[styles.statusText, { color: c.statusText }]}>counteroffer</ThemedText>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
            <View style={styles.headerRight}>
              {!showLeakSheet && isInvolved && (
                <TouchableOpacity
                  onPress={handleOpenChat}
                  accessibilityRole="button"
                  accessibilityLabel="Open trade chat"
                  hitSlop={12}
                  style={[styles.chatBtn, { backgroundColor: c.accent }]}
                >
                  <Ionicons name="chatbubble-ellipses" size={15} color={c.statusText} />
                  <ThemedText style={[styles.chatBtnLabel, { color: c.statusText }]}>Chat</ThemedText>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close trade details"
                hitSlop={12}
                style={[styles.closeBtn, { backgroundColor: c.cardAlt }]}
              >
                <Ionicons name="close" size={18} color={c.secondaryText} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Leak sheet ── */}
          {showLeakSheet ? (
            <LeakRumorSheet
              proposalId={proposal.id}
              leagueId={leagueId}
              teamId={teamId}
              players={leakPlayers}
              onDone={() => setShowLeakSheet(false)}
            />
          ) : (
            <>
              <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

                {/* Status timeline */}
                <TradeStatusTimeline status={proposal.status} reviewCountdown={reviewCountdown} />

                {/* Veto info */}
                {proposal.status === 'in_review' && leagueSettings?.trade_veto_type === 'league_vote' && (
                  <View style={[styles.infoChip, { backgroundColor: c.cardAlt }]}>
                    <Ionicons name="people" size={14} color={c.secondaryText} />
                    <ThemedText style={[styles.infoChipText, { color: c.secondaryText }]}>
                      Veto votes: {vetoCount} / {leagueSettings.trade_votes_to_veto} needed
                    </ThemedText>
                  </View>
                )}

                {/* Trade sides — two-column for 2-team, stacked for 3+ */}
                <View style={isTwoTeam ? styles.twoCol : styles.stacked}>
                  {proposal.teams.map((t) => (
                    <View key={t.team_id} style={isTwoTeam ? styles.colHalf : styles.stackedCard}>
                      <TradeSideSummary
                        teamId={t.team_id}
                        teamName={t.team_name}
                        receivedItems={receivedByTeam[t.team_id] ?? []}
                        playerFptsMap={playerFptsMap}
                        playerHeadshotMap={playerHeadshotMap}
                        newItemKeys={newItemKeys}
                        itemKeyFn={itemKey}
                        teamNameMap={teamNameMap}
                        teamStatus={proposal.status === 'pending' ? t.status : undefined}
                        isMultiTeam={!isTwoTeam}
                      />
                    </View>
                  ))}
                </View>

                {/* Swap icon between columns for 2-team trades */}
                {/* (Rendered via negative margin overlay in styles) */}

                {/* Fairness bar */}
                {!isCategories && fairness.length > 0 && (
                  <View style={styles.fairnessWrap}>
                    <TradeFairnessBar teams={fairness} />
                  </View>
                )}

                {/* Roster capacity warning */}
                {wouldExceedRoster && !showDropPicker && (
                  <View
                    accessibilityRole="alert"
                    style={[styles.warningBanner, { backgroundColor: c.warningMuted, borderColor: c.warning }]}
                  >
                    <Ionicons name="warning" size={16} color={c.warning} />
                    <ThemedText style={[styles.warningText, { color: c.warning }]}>
                      Accepting will exceed your roster limit. You'll need to drop a player.
                    </ThemedText>
                  </View>
                )}

                {/* Pending drops — waiting on other teams */}
                {proposal.status === 'pending_drops' && !needsMyDrop && (
                  <View style={[styles.infoChip, { backgroundColor: c.cardAlt }]}>
                    <Ionicons name="hourglass-outline" size={14} color={c.secondaryText} />
                    <ThemedText style={[styles.infoChipText, { color: c.secondaryText }]}>
                      Waiting for roster drops before this trade can complete.
                    </ThemedText>
                  </View>
                )}

                {/* Drop picker */}
                {(showDropPicker || needsMyDrop) && myRoster && Array.isArray(myRoster) && myRoster.length > 0 && (
                  <DropPickerSection
                    roster={myRoster}
                    selectedPlayerIds={selectedDropPlayerIds}
                    maxSelections={dropsNeeded}
                    onSelect={setSelectedDropPlayerIds}
                  />
                )}

                {/* Trade note */}
                {proposal.notes && (
                  <View style={[styles.noteCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                    <ThemedText style={[styles.noteLabel, { color: c.secondaryText }]}>Note</ThemedText>
                    <ThemedText style={styles.noteText}>{proposal.notes}</ThemedText>
                  </View>
                )}

                {/* Terminal status explanation */}
                {isTerminal && (
                  <View style={[styles.terminalBanner, { backgroundColor: statusColor + '18' }]}>
                    <Ionicons
                      name={
                        proposal.status === 'completed' ? 'checkmark-circle'
                        : proposal.status === 'rejected' ? 'close-circle'
                        : proposal.status === 'vetoed' ? 'ban'
                        : 'arrow-undo'
                      }
                      size={18}
                      color={statusColor}
                    />
                    <ThemedText style={[styles.terminalText, { color: statusColor }]}>
                      {proposal.status === 'completed' ? 'This trade has been completed.'
                       : proposal.status === 'rejected' ? 'This trade was declined.'
                       : proposal.status === 'vetoed' ? 'This trade was vetoed.'
                       : proposal.status === 'cancelled' ? 'This trade was withdrawn.'
                       : 'This trade was reversed.'}
                    </ThemedText>
                  </View>
                )}
              </ScrollView>

              {/* ── Action bar ── */}
              <TradeActionBar
                processing={actions.processing}
                status={proposal.status}
                isInvolved={isInvolved}
                isProposer={isProposer}
                isEditable={isEditable}
                isCommissioner={isCommissioner ?? false}
                myTeamStatus={myTeamStatus}
                hasVoted={hasVoted}
                vetoType={leagueSettings?.trade_veto_type}
                showDropPicker={showDropPicker}
                dropsReady={selectedDropPlayerIds.length >= dropsNeeded && dropsNeeded > 0}
                needsMyDrop={needsMyDrop}
                canLeak={!!(canLeak && !isTerminal && isInvolved && proposal.counteroffer_of && leakPlayers.length > 0)}
                onAccept={() => actions.handleAccept(() => setShowDropPicker(true))}
                onReject={actions.handleReject}
                onCancel={actions.handleCancel}
                onEdit={onEdit ? () => onEdit(proposal) : undefined}
                onCounteroffer={onCounteroffer ? () => onCounteroffer(proposal) : undefined}
                onCommissionerApprove={actions.handleCommissionerApprove}
                onCommissionerVeto={actions.handleCommissionerVeto}
                onVoteToVeto={actions.handleVoteToVeto}
                onSubmitDrop={actions.handleSubmitDrop}
                onLeakToChat={() => setShowLeakSheet(true)}
              />
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
    paddingBottom: s(32),
  },
  sheetExpanded: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: s(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    flex: 1,
  },
  headerTitle: {
    fontSize: ms(18),
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  statusBadge: {
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 5,
  },
  statusText: {
    fontSize: ms(11),
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 8,
  },
  chatBtnLabel: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  closeBtn: {
    width: s(30),
    height: s(30),
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Content
  content: {
    padding: s(16),
    gap: s(14),
    paddingBottom: s(8),
  },

  // Two-column layout for 2-team trades
  twoCol: {
    flexDirection: 'row',
    gap: s(10),
  },
  colHalf: {
    flex: 1,
  },

  // Stacked layout for 3+ team trades
  stacked: {
    gap: s(10),
  },
  stackedCard: {},

  // Info chips
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    alignSelf: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 8,
  },
  infoChipText: {
    fontSize: ms(12),
    fontWeight: '500',
  },

  // Fairness
  fairnessWrap: {},

  // Warning
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    borderWidth: 1,
    borderRadius: 10,
    padding: s(12),
  },
  warningText: {
    fontSize: ms(13),
    fontWeight: '600',
    flex: 1,
  },

  // Note
  noteCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: s(12),
    gap: s(4),
  },
  noteLabel: {
    fontSize: ms(11),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noteText: {
    fontSize: ms(14),
    lineHeight: ms(20),
  },

  // Terminal banner
  terminalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    padding: s(12),
    borderRadius: 10,
  },
  terminalText: {
    fontSize: ms(13),
    fontWeight: '600',
    flex: 1,
  },
});
