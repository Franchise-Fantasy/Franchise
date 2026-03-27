import { AvailablePlayers } from '@/components/draft/AvailablePlayers';
import { PresenceAvatars } from '@/components/chat/PresenceAvatars';
import { DraftOrder, PresenceTeam } from '@/components/draft/DraftOrder';
import { TeamLogo } from '@/components/team/TeamLogo';
import { DraftQueue } from '@/components/draft/DraftQueue';
import { TeamRoster } from '@/components/draft/TeamRoster';
import { DraftChatModal } from '@/components/draft/DraftChatModal';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { TradeDetailModal } from '@/components/trade/TradeDetailModal';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { supabase } from '@/lib/supabase';
import { CurrentPick, DraftState } from '@/types/draft';
import { setDraftRoomOpen } from '@/lib/activeScreen';
import { capture } from '@/lib/posthog';
import { useDraftQueue } from '@/hooks/useDraftQueue';
import { useTradeProposals, TradeProposalRow } from '@/hooks/useTrades';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';

type ViewMode = 'players' | 'roster' | 'queue' | 'trades';



export default function DraftRoomScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const queryClient = useQueryClient();
  const { id: draftId } = useLocalSearchParams<{ id: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>('players');
  const [currentPick, setCurrentPick] = useState<CurrentPick | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [presentTeams, setPresentTeams] = useState<PresenceTeam[]>([]);
  const [showPresenceList, setShowPresenceList] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [autopickOn, setAutopickOn] = useState(false);
  const handlePresenceChange = useCallback((teams: PresenceTeam[]) => setPresentTeams(teams), []);

  // Sync autopick state from DB so it survives re-mounts
  const { data: dbAutopick } = useQuery({
    queryKey: ['autopickStatus', draftId, teamData?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('draft_team_status')
        .select('autopick_on')
        .eq('draft_id', draftId)
        .eq('team_id', teamData!.id)
        .maybeSingle();
      return data?.autopick_on ?? false;
    },
    enabled: !!teamData?.id,
  });

  // Seed local state from DB on first load
  useEffect(() => {
    if (dbAutopick !== undefined) setAutopickOn(dbAutopick);
  }, [dbAutopick]);

  // First, get the league ID and draft type from the draft
  const { data: draftData, isError: isDraftError } = useQuery({
    queryKey: ['draft', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('league_id, type')
        .eq('id', draftId)
        .single();

      if (error) throw error;
      return data;
    }
  });

  const isRookieDraft = draftData?.type === 'rookie';

  // Suppress draft push notifications while this screen is open
  useEffect(() => {
    setDraftRoomOpen(true);
    capture('draft_room_entered', { draft_id: draftId });
    return () => setDraftRoomOpen(false);
  }, []);

  // Shared cache key with DraftOrder's real-time subscription — updates automatically
  const { data: draftState } = useQuery<DraftState>({
    queryKey: ['draftState', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('*')
        .eq('id', draftId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const isDraftComplete = draftState?.status === 'complete';

  // Auto-generate schedule when initial draft completes (idempotent — edge fn ignores duplicates)
  // Rookie drafts don't trigger schedule generation (offseason handles that separately)
  useEffect(() => {
    if (!isDraftComplete || !draftData?.league_id) return;
    // Unlock free-agent adds across all screens that cache this query
    queryClient.invalidateQueries({ queryKey: ['hasActiveDraft', draftData.league_id] });
    if (isRookieDraft) return;
    supabase.functions
      .invoke('generate-schedule', { body: { league_id: draftData.league_id } })
      .catch(() => {});
  }, [isDraftComplete, draftData?.league_id, isRookieDraft, queryClient]);

  // Then, use the league ID to get the user's team + commissioner status
  const { data: teamData, isLoading: isLoadingTeam } = useQuery({
    queryKey: ['myTeam', draftData?.league_id],
    queryFn: async () => {
      if (!draftData?.league_id) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const [teamRes, leagueRes] = await Promise.all([
        supabase.from('teams').select('id, name, tricode, logo_key').eq('league_id', draftData.league_id).eq('user_id', user.id).single(),
        supabase.from('leagues').select('created_by').eq('id', draftData.league_id).single(),
      ]);
      if (teamRes.error) throw teamRes.error;
      return { ...teamRes.data, isCommissioner: leagueRes.data?.created_by === user.id };
    },
    enabled: !!draftData?.league_id
  });

  // Map presence data for PresenceAvatars (exclude self)
  const otherTeams = useMemo(
    () => presentTeams
      .filter((t) => t.teamId !== teamData?.id)
      .map((t) => ({
        team_id: t.teamId,
        team_name: t.teamName,
        tricode: t.tricode,
        last_read_message_id: null,
        online: true,
      })),
    [presentTeams, teamData?.id],
  );
  const presenceLogoMap = useMemo(
    () => Object.fromEntries(presentTeams.map((t) => [t.teamId, t.logoKey])),
    [presentTeams],
  );

  // Fetch draft pick trading setting
  const { data: leagueSettings } = useQuery({
    queryKey: ['draftLeagueSettings', draftData?.league_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('draft_pick_trading_enabled')
        .eq('id', draftData!.league_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!draftData?.league_id,
  });

  const { addToQueue, queuedPlayerIds } = useDraftQueue(
    draftId,
    teamData?.id || '',
    draftData?.league_id || '',
  );

  const draftPickTradingEnabled = leagueSettings?.draft_pick_trading_enabled ?? false;
  const showTradeButton = draftPickTradingEnabled && !isDraftComplete;

  // Trade proposals for the draft trades tab — polls every 10s so the other
  // team sees incoming proposals without needing a realtime subscription.
  const { data: tradeProposals } = useTradeProposals(showTradeButton ? draftData?.league_id ?? null : null);
  const [selectedProposal, setSelectedProposal] = useState<TradeProposalRow | null>(null);
  const myPendingCount = (tradeProposals ?? []).filter(
    (p) => p.status === 'pending' && p.teams.some((t) => t.team_id === teamData?.id && t.status === 'pending'),
  ).length;

  // Poll trade proposals during draft so both teams see updates
  useEffect(() => {
    if (!draftData?.league_id || !showTradeButton) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['tradeProposals', draftData.league_id] });
    }, 10_000);
    return () => clearInterval(interval);
  }, [draftData?.league_id, showTradeButton, queryClient]);

  // Autopick is purely user-controlled. Local state is the source of truth.

  const isMyTurn = currentPick?.current_team_id === teamData?.id;

  const handleAutopickToggle = async () => {
    if (!teamData?.id) return;
    if (!autopickOn) {
      // Turning ON
      const enable = async () => {
        setAutopickOn(true);
        supabase.rpc('set_autopick', {
          p_draft_id: draftId,
          p_team_id: teamData.id,
          p_enabled: true,
        }).then(() => {
          if (isMyTurn) {
            supabase.functions.invoke('trigger-autopick', { body: { draft_id: draftId } });
          }
        });
      };

      if (isMyTurn) {
        Alert.alert(
          'Enable Autopick',
          'Your current pick will be made automatically. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enable', onPress: enable },
          ],
        );
      } else {
        await enable();
      }
    } else {
      // Turning OFF — await to ensure DB is updated before any queued autodraft fires
      setAutopickOn(false);
      const { error } = await supabase.rpc('set_autopick', {
        p_draft_id: draftId,
        p_team_id: teamData.id,
        p_enabled: false,
      });
      if (error) {
        // Revert local state if DB update failed
        setAutopickOn(true);
        Alert.alert('Error', 'Failed to turn off autopick. Please try again.');
      } else {
        queryClient.invalidateQueries({ queryKey: ['autopickStatus', draftId, teamData.id] });
      }
    }
  };

  if (isDraftError && !draftData) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ThemedView style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.headerButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
            <ThemedText style={[styles.backButton, { color: colors.activeText }]}>←</ThemedText>
          </TouchableOpacity>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle}>Draft</ThemedText>
          <View style={styles.headerButton} />
        </ThemedView>
        <ThemedText style={{ textAlign: 'center', marginTop: 40, fontSize: 15, color: colors.secondaryText }}>
          Draft not found
        </ThemedText>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ThemedView style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ThemedText style={[styles.backButton, { color: colors.activeText }]}>←</ThemedText>
        </TouchableOpacity>

        <ThemedText type="title" style={styles.headerText} accessibilityRole="header">
          {isDraftComplete
            ? (isRookieDraft ? 'Rookie Draft Complete' : 'Draft Complete')
            : (isRookieDraft ? 'Rookie Draft' : 'Draft Room')}
        </ThemedText>

        <View style={styles.headerRight}>
          {!isDraftComplete && teamData && (
            <TouchableOpacity
              onPress={handleAutopickToggle}
              style={[
                styles.autoBadge,
                { borderColor: autopickOn ? colors.success : colors.border },
                autopickOn && { backgroundColor: colors.successMuted },
              ]}
              accessibilityRole="button"
              accessibilityLabel={autopickOn ? 'Disable autopick' : 'Enable autopick'}
              accessibilityState={{ selected: autopickOn }}
            >
              <ThemedText style={[
                styles.autoBadgeText,
                { color: autopickOn ? colors.success : colors.secondaryText },
              ]}>
                AUTO
              </ThemedText>
            </TouchableOpacity>
          )}
          {!isDraftComplete && teamData && (
            <PresenceAvatars
              onlineTeams={otherTeams}
              teamLogoMap={presenceLogoMap}
              myTeamId={teamData.id}
              myTeamName={teamData.name}
              myLogoKey={teamData.logo_key ?? null}
              myTricode={teamData.tricode ?? null}
              onPress={() => setShowPresenceList(true)}
            />
          )}
        </View>
      </ThemedView>

      <View style={styles.content}>
        {isDraftComplete ? (
          <View style={[styles.completeBanner, { backgroundColor: colors.activeCard, borderBottomColor: colors.activeBorder }]}>
            <ThemedText type="defaultSemiBold" style={{ color: colors.activeText }}>
              {isRookieDraft ? 'The rookie draft is over!' : 'The draft is over!'}
            </ThemedText>
            <ThemedText style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>
              {isRookieDraft
                ? 'Check your new rookies. Head back to the home screen.'
                : 'Free agency is now open. Head back to the home screen.'}
            </ThemedText>
          </View>
        ) : (
          <DraftOrder
            draftId={draftId}
            onCurrentPickChange={setCurrentPick}
            teamId={teamData?.id || ''}
            teamName={teamData?.name || ''}
            tricode={teamData?.tricode || ''}
            logoKey={teamData?.logo_key ?? null}
            isCommissioner={teamData?.isCommissioner ?? false}
            autopickPending={autopickOn}
            onPresenceChange={handlePresenceChange}
          />
        )}

        {/* Main Content Area */}
        <View style={styles.mainContent}>
          {viewMode === 'players' ? (
            <AvailablePlayers
              draftId={draftId}
              currentPick={currentPick}
              teamId={teamData?.id || ''}
              leagueId={draftData?.league_id || ''}
              isRookieDraft={isRookieDraft}
              addToQueue={addToQueue}
              queuedPlayerIds={queuedPlayerIds}
            />
          ) : viewMode === 'queue' ? (
            <DraftQueue
              draftId={draftId}
              leagueId={draftData?.league_id || ''}
              teamId={teamData?.id || ''}
              currentPick={currentPick}
            />
          ) : viewMode === 'trades' ? (
            <View style={{ flex: 1 }}>
              <TouchableOpacity
                style={[styles.proposeBtn, { backgroundColor: colors.accent }]}
                onPress={() => setShowTradeModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Propose a new trade"
              >
                <Ionicons name="add" size={18} color={colors.statusText} accessible={false} />
                <ThemedText style={{ color: colors.statusText, fontWeight: '600', fontSize: 14 }}>Propose Trade</ThemedText>
              </TouchableOpacity>
              <FlatList
                data={(tradeProposals ?? []).filter((p) => ['pending', 'in_review'].includes(p.status))}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingBottom: 16 }}
                ListEmptyComponent={
                  <ThemedText style={{ textAlign: 'center', marginTop: 40, color: colors.secondaryText, fontSize: 14 }}>
                    No active trade proposals
                  </ThemedText>
                }
                renderItem={({ item }) => {
                  const needsResponse = item.teams.some(
                    (t) => t.team_id === teamData?.id && t.status === 'pending',
                  ) && item.proposed_by_team_id !== teamData?.id;
                  const teamNames = item.teams.map((t) => t.team_name).join(' ↔ ');
                  return (
                    <TouchableOpacity
                      style={[styles.tradeRow, { borderBottomColor: colors.border }, needsResponse && { backgroundColor: colors.activeCard }]}
                      onPress={() => setSelectedProposal(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Trade between ${teamNames}${needsResponse ? ', needs your response' : ''}`}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemedText type="defaultSemiBold" style={{ fontSize: 14 }} numberOfLines={1}>
                          {teamNames}
                        </ThemedText>
                        <ThemedText style={{ fontSize: 12, color: colors.secondaryText, marginTop: 2 }}>
                          {item.items.filter((i) => i.draft_pick_id).length} pick(s) · {item.items.filter((i) => i.player_id).length} player(s)
                        </ThemedText>
                      </View>
                      {needsResponse && (
                        <View style={[styles.responseBadge, { backgroundColor: colors.accent }]}>
                          <ThemedText style={{ color: colors.statusText, fontSize: 10, fontWeight: '800' }}>RESPOND</ThemedText>
                        </View>
                      )}
                      <Ionicons name="chevron-forward" size={16} color={colors.secondaryText} accessible={false} />
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          ) : (
            <TeamRoster
              teamId={teamData?.id || ''}
              leagueId={draftData?.league_id || ''}
            />
          )}
        </View>

        {/* Toggle Buttons — bottom bar */}
        <View style={[styles.toggleContainer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === 'players' && { backgroundColor: colors.activeCard }
            ]}
            onPress={() => setViewMode('players')}
            accessibilityRole="button"
            accessibilityLabel="Available Players"
            accessibilityState={{ selected: viewMode === 'players' }}
          >
            <ThemedText style={[
              { color: colors.secondaryText },
              viewMode === 'players' && { color: colors.activeText, fontWeight: 'bold' }
            ]}>
              Players
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === 'queue' && { backgroundColor: colors.activeCard }
            ]}
            onPress={() => setViewMode('queue')}
            accessibilityRole="button"
            accessibilityLabel="Draft Queue"
            accessibilityState={{ selected: viewMode === 'queue' }}
          >
            <ThemedText style={[
              { color: colors.secondaryText },
              viewMode === 'queue' && { color: colors.activeText, fontWeight: 'bold' }
            ]}>
              Queue
            </ThemedText>
          </TouchableOpacity>
          {showTradeButton && (
            <TouchableOpacity
              style={[
                styles.toggleButton,
                viewMode === 'trades' && { backgroundColor: colors.activeCard },
              ]}
              onPress={() => setViewMode('trades')}
              accessibilityRole="button"
              accessibilityLabel="Trades"
              accessibilityState={{ selected: viewMode === 'trades' }}
            >
              <ThemedText style={[
                { color: colors.secondaryText },
                viewMode === 'trades' && { color: colors.activeText, fontWeight: 'bold' },
              ]}>
                Trades{myPendingCount > 0 ? ` (${myPendingCount})` : ''}
              </ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === 'roster' && { backgroundColor: colors.activeCard }
            ]}
            onPress={() => setViewMode('roster')}
            accessibilityRole="button"
            accessibilityLabel="My Team"
            accessibilityState={{ selected: viewMode === 'roster' }}
          >
            <ThemedText style={[
              { color: colors.secondaryText },
              viewMode === 'roster' && { color: colors.activeText, fontWeight: 'bold' }
            ]}>
              My Team
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={showPresenceList}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPresenceList(false)}
      >
        <Pressable style={styles.presenceOverlay} onPress={() => setShowPresenceList(false)}>
          <View style={[styles.presenceModal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ThemedText type="defaultSemiBold" style={{ marginBottom: 8 }}>
              Online ({presentTeams.length}/{draftState?.picks_per_round ?? '?'})
            </ThemedText>
            <FlatList
              data={presentTeams}
              keyExtractor={(item) => item.teamId}
              renderItem={({ item, index }) => (
                <View style={[styles.presenceRow, { borderBottomColor: colors.border }, index === presentTeams.length - 1 && { borderBottomWidth: 0 }]}>
                  <TeamLogo
                    logoKey={item.logoKey}
                    teamName={item.teamName}
                    tricode={item.tricode}
                    size="small"
                  />
                  <ThemedText accessibilityLabel={`${item.teamName} is online`}>
                    {item.teamName}
                  </ThemedText>
                  <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
                </View>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      {showTradeModal && draftData?.league_id && teamData?.id && (
        <ProposeTradeModal
          leagueId={draftData.league_id}
          teamId={teamData.id}
          onClose={() => {
            setShowTradeModal(false);
            queryClient.invalidateQueries({ queryKey: ['tradeProposals', draftData.league_id] });
            queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
          }}
        />
      )}

      {selectedProposal && draftData?.league_id && teamData?.id && (
        <TradeDetailModal
          proposal={selectedProposal}
          leagueId={draftData.league_id}
          teamId={teamData.id}
          onClose={() => {
            setSelectedProposal(null);
            queryClient.invalidateQueries({ queryKey: ['tradeProposals', draftData.league_id] });
            queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
          }}
        />
      )}

      {/* Floating chat button */}
      {teamData && (
        <TouchableOpacity
          style={[styles.chatFab, { backgroundColor: colors.accent }]}
          onPress={() => setShowChat(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open league chat"
        >
          <Ionicons name="chatbubble-ellipses" size={22} color={colors.statusText} />
        </TouchableOpacity>
      )}

      {draftData?.league_id && teamData?.id && (
        <DraftChatModal
          visible={showChat}
          leagueId={draftData.league_id}
          teamId={teamData.id}
          teamName={teamData.name}
          isCommissioner={teamData.isCommissioner ?? false}
          onClose={() => setShowChat(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    height: 50,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'thin',
    marginHorizontal: 40,
  },
  headerButton: {
    padding: 8,
    width: 36,
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  toggleContainer: {
    flexDirection: 'row',
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  mainContent: {
    flex: 1,
  },
  backButton: {
    fontSize: 24,
  },
  completeBanner: {
    padding: 12,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  presenceOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  presenceModal: {
    width: 300,
    maxHeight: '70%',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  autoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  proposeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    margin: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  responseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  autoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  chatFab: {
    position: 'absolute',
    right: 16,
    bottom: 60,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});