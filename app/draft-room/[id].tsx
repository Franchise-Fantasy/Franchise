import { AvailablePlayers } from '@/components/draft/AvailablePlayers';
import { DraftOrder, PresenceTeam } from '@/components/draft/DraftOrder';
import { TeamRoster } from '@/components/draft/TeamRoster';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { supabase } from '@/lib/supabase';
import { CurrentPick, DraftState } from '@/types/draft';
import { setDraftRoomOpen } from '@/lib/activeScreen';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, FlatList, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';

type ViewMode = 'players' | 'roster';



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
  const handlePresenceChange = useCallback((teams: PresenceTeam[]) => setPresentTeams(teams), []);

  // First, get the league ID and draft type from the draft
  const { data: draftData } = useQuery({
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
    if (!isDraftComplete || !draftData?.league_id || isRookieDraft) return;
    supabase.functions
      .invoke('generate-schedule', { body: { league_id: draftData.league_id } })
      .catch(() => {});
  }, [isDraftComplete, draftData?.league_id, isRookieDraft]);

  // Then, use the league ID to get the user's team + commissioner status
  const { data: teamData, isLoading: isLoadingTeam } = useQuery({
    queryKey: ['myTeam', draftData?.league_id],
    queryFn: async () => {
      if (!draftData?.league_id) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const [teamRes, leagueRes] = await Promise.all([
        supabase.from('teams').select('id, name').eq('league_id', draftData.league_id).eq('user_id', user.id).single(),
        supabase.from('leagues').select('created_by').eq('id', draftData.league_id).single(),
      ]);
      if (teamRes.error) throw teamRes.error;
      return { ...teamRes.data, isCommissioner: leagueRes.data?.created_by === user.id };
    },
    enabled: !!draftData?.league_id
  });

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

  const draftPickTradingEnabled = leagueSettings?.draft_pick_trading_enabled ?? false;
  const showTradeButton = draftPickTradingEnabled && draftState?.status === 'in_progress' && !isDraftComplete;

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
          {presentTeams.length > 0 && !isDraftComplete && (
            <TouchableOpacity
              onPress={() => setShowPresenceList(true)}
              style={[styles.presencePill, { backgroundColor: colors.activeCard }]}
              accessibilityRole="button"
              accessibilityLabel={`${presentTeams.length} of ${draftState?.picks_per_round ?? '?'} teams online in draft room`}
            >
              <View style={styles.presenceDot} />
              <ThemedText style={[styles.presenceText, { color: colors.activeText }]}>
                {presentTeams.length}/{draftState?.picks_per_round ?? '?'}
              </ThemedText>
            </TouchableOpacity>
          )}
          {showTradeButton && (
            <TouchableOpacity
              onPress={() => setShowTradeModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Trade draft picks"
            >
              <Ionicons name="swap-horizontal" size={22} color={colors.accent} accessible={false} />
            </TouchableOpacity>
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
            isCommissioner={teamData?.isCommissioner ?? false}
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
            />
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
              Available Players
            </ThemedText>
          </TouchableOpacity>
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
              renderItem={({ item }) => (
                <View style={[styles.presenceRow, { borderBottomColor: colors.border }]}>
                  <View style={styles.presenceDot} />
                  <ThemedText accessibilityLabel={`${item.teamName} is online`}>
                    {item.teamName}
                  </ThemedText>
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
          instantExecute
          onClose={() => {
            setShowTradeModal(false);
            queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
          }}
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
  presencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  presenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
    marginRight: 4,
  },
  presenceText: {
    fontSize: 12,
    fontWeight: '600',
  },
  presenceOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  presenceModal: {
    width: 250,
    maxHeight: 300,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});