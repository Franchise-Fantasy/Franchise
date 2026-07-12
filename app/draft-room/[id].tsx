import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LeagueChatPanel } from '@/components/chat/LeagueChatPanel';
import { PresenceAvatars } from '@/components/chat/PresenceAvatars';
import { PresenceListSheet, type PresenceEntry } from '@/components/chat/PresenceListSheet';
import { AvailablePlayers } from '@/components/draft/AvailablePlayers';
import { CommishDraftControlsSheet } from '@/components/draft/CommishDraftControlsSheet';
import { DraftChatModal } from '@/components/draft/DraftChatModal';
import { DraftOrder, PresenceTeam } from '@/components/draft/DraftOrder';
import { DraftQueue } from '@/components/draft/DraftQueue';
import { TeamRoster } from '@/components/draft/TeamRoster';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { TradeDetailModal } from '@/components/trade/TradeDetailModal';
import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Colors, Fonts } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { useToast } from '@/context/ToastProvider';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useColors } from '@/hooks/useColors';
import { useDraftQueue } from '@/hooks/useDraftQueue';
import { useRosterChanges } from '@/hooks/useRosterChanges';
import { useTradeProposals, TradeProposalRow } from '@/hooks/useTrades';
import { setDraftRoomOpen } from '@/lib/activeScreen';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { CurrentPick, DraftState } from '@/types/draft';
import { ms, s } from '@/utils/scale';

type ViewMode = 'players' | 'roster' | 'queue' | 'trades';

/**
 * Bottom-bar tab — varsity caps with gold-underline active. Subordinate
 * to the page header chrome above; matches the within-tab filter pattern
 * used in ByYearTab + ProspectsTab so the room reads as one consistent
 * surface rather than competing pill rows.
 */
function ToggleTab({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: typeof Colors.light;
}) {
  return (
    <TouchableOpacity
      style={styles.toggleButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      activeOpacity={0.7}
    >
      <ThemedText
        type="varsity"
        style={[
          styles.toggleText,
          { color: active ? colors.text : colors.secondaryText },
        ]}
      >
        {label}
      </ThemedText>
      <View
        style={[
          styles.toggleUnderline,
          { backgroundColor: active ? colors.gold : 'transparent' },
        ]}
      />
    </TouchableOpacity>
  );
}

/** Label-over-value stat in the desktop header's center meta cluster. */
function DeskMetaItem({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: typeof Colors.light;
}) {
  return (
    <View style={styles.deskMetaItem} accessibilityLabel={`${label} ${value}`}>
      <ThemedText type="varsitySmall" style={[styles.deskMetaLabel, { color: colors.secondaryText }]}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.deskMetaValue, { color: colors.text }]}>{value}</ThemedText>
    </View>
  );
}



export default function DraftRoomScreen() {
  const confirm = useConfirm();
  const colors = useColors();
  const { isDesktop, isWide } = useBreakpoint();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { id: draftId } = useLocalSearchParams<{ id: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>('players');
  const [currentPick, setCurrentPick] = useState<CurrentPick | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [presentTeams, setPresentTeams] = useState<PresenceTeam[]>([]);
  const [showPresenceList, setShowPresenceList] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showCommishControls, setShowCommishControls] = useState(false);
  const [autopickOn, setAutopickOn] = useState(false);
  const handlePresenceChange = useCallback((teams: PresenceTeam[]) => setPresentTeams(teams), []);

  // ─── Single RPC to load all draft room init data ───────────
  // Replaces 5+ separate queries (drafts x2, teams, leagues x2, draft_team_status)
  const { data: initData, isError: isDraftError } = useQuery({
    queryKey: queryKeys.draftRoomInit(draftId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_draft_room_init' as any, {
        p_draft_id: draftId,
      });
      if (error) throw error;
      return data as unknown as {
        draft: DraftState;
        team: { id: string; name: string; tricode: string | null; logo_key: string | null; is_commissioner: boolean };
        draft_pick_trading_enabled: boolean;
        autopick_on: boolean;
      };
    },
  });

  // Derive convenience accessors from the init RPC.
  // teamData is memoized because it feeds the presenceEntries useMemo
  // below — without memoization a new object identity every render
  // would invalidate the entries list and force re-renders downstream.
  const draftData = initData ? { league_id: initData.draft.league_id, type: initData.draft.type } : undefined;
  const teamData = useMemo(
    () => (initData?.team ? { ...initData.team, isCommissioner: initData.team.is_commissioner } : undefined),
    [initData?.team],
  );
  const isRookieDraft = draftData?.type === 'rookie';
  const draftPickTradingEnabled = initData?.draft_pick_trading_enabled ?? false;

  // Seed the shared draftState cache so DraftOrder's realtime subscription updates it
  useEffect(() => {
    if (initData?.draft) {
      queryClient.setQueryData(queryKeys.draftState(draftId), initData.draft);
    }
  }, [initData?.draft, draftId, queryClient]);

  // Seed autopick local state from init RPC
  useEffect(() => {
    if (initData?.autopick_on !== undefined) setAutopickOn(initData.autopick_on);
  }, [initData?.autopick_on]);

  // Shared cache key with DraftOrder's real-time subscription — updates automatically
  const { data: draftState } = useQuery<DraftState>({
    queryKey: queryKeys.draftState(draftId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('*')
        .eq('id', draftId)
        .single();
      if (error) throw error;
      return data as unknown as DraftState;
    },
    // Seeded from initData above; only refetches if realtime invalidates
    enabled: !!initData,
  });

  const isDraftComplete = draftState?.status === 'complete';

  // Shared realtime subscription for league_players changes (draft picks, etc.)
  useRosterChanges(draftData?.league_id ?? null);

  // Suppress draft push notifications while this screen is open
  useEffect(() => {
    setDraftRoomOpen(true);
    capture('draft_room_entered', { draft_id: draftId });
    return () => setDraftRoomOpen(false);
  }, []);

  // Auto-generate schedule when the initial draft completes.
  // Rookie drafts don't trigger schedule generation (offseason handles that separately).
  // Only the commissioner is authorized for this (non-imported) path, so only they
  // fire it — this avoids every member's client racing redundant 403s, and lets us
  // surface a real failure to the one person who can act on it (rather than the old
  // fail-silent behavior that left the draft looking "stuck" with no signal). The
  // benign "already generated" conflict on re-entry is ignored — the edge fn is
  // idempotent and that's not an error worth a toast.
  useEffect(() => {
    if (!isDraftComplete || !draftData?.league_id) return;
    // Unlock free-agent adds across all screens that cache this query
    queryClient.invalidateQueries({ queryKey: queryKeys.hasActiveDraft(draftData.league_id) });
    if (isRookieDraft || !teamData?.isCommissioner) return;

    const leagueId = draftData.league_id;
    (async () => {
      const res = await supabase.functions.invoke('generate-schedule', { body: { league_id: leagueId } });
      if (!res.error && !res.data?.error) return;

      // FunctionsHttpError stashes the Response on .context — pull the real reason
      // (stale season start, invalid season length, etc.) out of its JSON body.
      let detail = res.data?.error ?? res.error?.message ?? 'Failed to generate schedule.';
      try {
        const body = await (res.error as { context?: Response } | null)?.context?.json?.();
        if (body?.error) detail = body.error;
      } catch {
        // Body wasn't JSON or context unavailable — keep the fallback.
      }
      if (detail === 'Schedule already generated') return; // idempotent re-entry, not a failure
      showToast('error', `Couldn't start the season: ${detail}`);
    })();
  }, [isDraftComplete, draftData?.league_id, isRookieDraft, teamData?.isCommissioner, queryClient, showToast]);

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

  // Build PresenceEntry[] for the shared "Who's Here" sheet. Self is
  // always online (we're rendering this screen), and we tag isMe so the
  // sheet labels us "(you)".
  const presenceEntries: PresenceEntry[] = useMemo(() => {
    if (!teamData) return [];
    const seen = new Set([teamData.id]);
    const entries: PresenceEntry[] = [
      {
        team_id: teamData.id,
        team_name: teamData.name,
        tricode: teamData.tricode ?? '',
        online: true,
        isMe: true,
      },
    ];
    for (const t of presentTeams) {
      if (seen.has(t.teamId)) continue;
      seen.add(t.teamId);
      entries.push({
        team_id: t.teamId,
        team_name: t.teamName,
        tricode: t.tricode ?? '',
        online: true,
      });
    }
    return entries;
  }, [presentTeams, teamData]);

  const { addToQueue, queuedPlayerIds } = useDraftQueue(
    draftId,
    teamData?.id || '',
    draftData?.league_id || '',
  );
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
      queryClient.invalidateQueries({ queryKey: queryKeys.tradeProposals(draftData.league_id) });
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
        const { error } = await supabase.rpc('set_autopick', {
          p_draft_id: draftId,
          p_team_id: teamData.id,
          p_enabled: true,
        });
        if (error) {
          setAutopickOn(false);
          Alert.alert('Error', 'Failed to turn on autopick. Please try again.');
          return;
        }
        if (isMyTurn) {
          supabase.functions.invoke('trigger-autopick', { body: { draft_id: draftId } });
        }
      };

      if (isMyTurn) {
        confirm({
          title: 'Enable Autopick',
          message: 'Your current pick will be made automatically. Continue?',
          action: { label: 'Enable', onPress: enable },
        });
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
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.headerButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
              <IconSymbol name="chevron.backward" size={20} color={colors.icon} accessible={false} />
            </TouchableOpacity>
          </View>
          <View style={styles.headerTitleAbsolute} pointerEvents="none">
            <ThemedText
              type="varsity"
              style={[styles.headerText, { color: colors.secondaryText }]}
              numberOfLines={1}
              accessibilityRole="header"
            >
              Draft
            </ThemedText>
          </View>
        </ThemedView>
        <ThemedText style={{ textAlign: 'center', marginTop: s(40), fontSize: ms(15), color: colors.secondaryText }}>
          Draft not found
        </ThemedText>
      </SafeAreaView>
    );
  }

  // On desktop the right rail has no "Players" tab (players are always shown on
  // the left), so fold the mobile default into Queue.
  const rightMode: Exclude<ViewMode, 'players'> =
    viewMode === 'players' ? 'queue' : viewMode;

  // A draft is a running conversation, so on a wide monitor the chat is a
  // permanent third rail rather than a button that hides it. Under 1440px there
  // isn't room for three columns, so it falls back to the header icon + sheet.
  const showChatRail = isWide && !!draftData?.league_id && !!teamData?.id;

  // Trades panel — shared by the mobile "Trades" tab and the desktop right rail.
  const tradesPanel = (
    <View style={{ flex: 1 }}>
      <View style={styles.proposeWrap}>
        <BrandButton
          label="Propose Trade"
          icon="add"
          onPress={() => setShowTradeModal(true)}
          variant="primary"
          fullWidth
          accessibilityLabel="Propose a new trade"
        />
      </View>
      <FlatList
        data={(tradeProposals ?? []).filter((p) => ['pending', 'in_review'].includes(p.status))}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: s(16) }}
        ListEmptyComponent={
          <ThemedText style={{ textAlign: 'center', marginTop: s(40), color: colors.secondaryText, fontSize: ms(14) }}>
            No active trade proposals
          </ThemedText>
        }
        renderItem={({ item }) => {
          const needsResponse = item.teams.some(
            (t) => t.team_id === teamData?.id && t.status === 'pending',
          ) && item.proposed_by_team_id !== teamData?.id;
          const teamNames = item.teams.map((t) => t.team_name).join(' ↔ ');
          const pickCount = item.items.filter((i) => i.draft_pick_id).length;
          const playerCount = item.items.filter((i) => i.player_id).length;
          return (
            <TouchableOpacity
              style={[styles.tradeRow, { borderBottomColor: colors.border }]}
              onPress={() => setSelectedProposal(item)}
              accessibilityRole="button"
              accessibilityLabel={`Trade between ${teamNames}${needsResponse ? ', needs your response' : ''}`}
            >
              <View style={{ flex: 1 }}>
                <ThemedText type="defaultSemiBold" style={styles.tradeRowTitle} numberOfLines={1}>
                  {teamNames}
                </ThemedText>
                <ThemedText style={[styles.tradeRowMeta, { color: colors.secondaryText }]}>
                  <ThemedText style={[styles.tradeRowCount, { color: colors.secondaryText }]}>
                    {pickCount}
                  </ThemedText>
                  {`  pick${pickCount === 1 ? '' : 's'}  ·  `}
                  <ThemedText style={[styles.tradeRowCount, { color: colors.secondaryText }]}>
                    {playerCount}
                  </ThemedText>
                  {`  player${playerCount === 1 ? '' : 's'}`}
                </ThemedText>
              </View>
              {needsResponse && <Badge label="Respond" variant="merlot" size="small" />}
              <Ionicons name="chevron-forward" size={16} color={colors.secondaryText} accessible={false} />
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — title is absolutely centered (PageHeader rhythm) so the
          left+right cluster widths can grow without shifting it sideways.
          Left: back chevron → AUTO badge. Right: chat icon → presence
          avatars. AUTO sits on the left so the right cluster stays focused
          on communication chrome (chat + who's here) and the presence
          avatars aren't crowded by a wide neutral pill. */}
      <ThemedView style={[styles.header, styles.headerClip, isDesktop && styles.deskHeader, { borderBottomColor: colors.border }]}>
        {isDesktop ? (
          <>
            {/* Left: a labeled Exit button + the room title, left-aligned like a
                desktop app bar (no absolutely-centered title). */}
            <View style={styles.deskHeaderLeft}>
              <TouchableOpacity
                style={[styles.exitBtn, { borderColor: colors.border }]}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Exit draft room"
              >
                <IconSymbol name="chevron.backward" size={16} color={colors.icon} accessible={false} />
                <ThemedText type="varsitySmall" style={[styles.exitLabel, { color: colors.text }]}>
                  Exit
                </ThemedText>
              </TouchableOpacity>
              <ThemedText
                type="varsity"
                style={[styles.deskTitle, { color: colors.text }]}
                numberOfLines={1}
                accessibilityRole="header"
              >
                {isDraftComplete
                  ? (isRookieDraft ? 'Rookie Draft Complete' : 'Draft Complete')
                  : (isRookieDraft ? 'Rookie Draft' : 'Draft Room')}
              </ThemedText>
            </View>
            {/* Center: the draft's shape — round, overall pick, clock length.
                On a phone this bar is full at 390px, so none of it fits; on a
                monitor the middle is dead space, and this is the context you'd
                otherwise have to open commissioner settings to see. */}
            {draftState && !isDraftComplete && (
              <View style={styles.deskMeta}>
                <DeskMetaItem
                  label="Round"
                  value={`${Math.min(
                    Math.floor((draftState.current_pick_number - 1) / draftState.picks_per_round) + 1,
                    draftState.rounds,
                  )} / ${draftState.rounds}`}
                  colors={colors}
                />
                <View style={[styles.deskMetaRule, { backgroundColor: colors.border }]} />
                <DeskMetaItem
                  label="Pick"
                  value={`${draftState.current_pick_number} / ${draftState.rounds * draftState.picks_per_round}`}
                  colors={colors}
                />
                <View style={[styles.deskMetaRule, { backgroundColor: colors.border }]} />
                <DeskMetaItem label="Clock" value={`${draftState.time_limit}s`} colors={colors} />
              </View>
            )}

            {/* Right: who's here (avatars + count) → autopick toggle → commish →
                chat, in that priority order. */}
            <View style={styles.deskHeaderRight}>
              {!isDraftComplete && teamData && (
                <TouchableOpacity
                  style={styles.deskPresence}
                  onPress={() => setShowPresenceList(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`${presenceEntries.length} here. See who's in the room`}
                >
                  <PresenceAvatars
                    onlineTeams={otherTeams}
                    teamLogoMap={presenceLogoMap}
                    myTeamId={teamData.id}
                    myTeamName={teamData.name}
                    myLogoKey={teamData.logo_key ?? null}
                    myTricode={teamData.tricode ?? null}
                    onPress={() => setShowPresenceList(true)}
                  />
                  <ThemedText type="varsitySmall" style={[styles.presenceCount, { color: colors.secondaryText }]}>
                    {presenceEntries.length} here
                  </ThemedText>
                </TouchableOpacity>
              )}
              {!isDraftComplete && teamData && (
                <TouchableOpacity
                  onPress={handleAutopickToggle}
                  accessibilityRole="button"
                  accessibilityLabel={autopickOn ? 'Disable autopick' : 'Enable autopick'}
                  accessibilityState={{ selected: autopickOn }}
                  style={[
                    styles.autopickToggle,
                    {
                      borderColor: autopickOn ? colors.gold : colors.border,
                      backgroundColor: autopickOn ? colors.gold + '1A' : 'transparent',
                    },
                  ]}
                >
                  <View style={[styles.autopickDot, { backgroundColor: autopickOn ? colors.gold : colors.secondaryText }]} />
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.autopickLabel, { color: autopickOn ? colors.text : colors.secondaryText }]}
                  >
                    Autopick {autopickOn ? 'On' : 'Off'}
                  </ThemedText>
                </TouchableOpacity>
              )}
              {teamData?.isCommissioner && !isDraftComplete && (
                <TouchableOpacity
                  onPress={() => setShowCommishControls(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Commissioner controls"
                  hitSlop={6}
                  style={styles.chatIconButton}
                >
                  <Ionicons name="settings-outline" size={20} color={colors.icon} />
                </TouchableOpacity>
              )}
              {teamData && !showChatRail && (
                <TouchableOpacity
                  onPress={() => setShowChat(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Open league chat"
                  hitSlop={6}
                  style={styles.chatIconButton}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.icon} />
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          <>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <IconSymbol name="chevron.backward" size={20} color={colors.icon} accessible={false} />
          </TouchableOpacity>
          {!isDraftComplete && teamData && (
            <TouchableOpacity
              onPress={handleAutopickToggle}
              accessibilityRole="button"
              accessibilityLabel={autopickOn ? 'Disable autopick' : 'Enable autopick'}
              accessibilityState={{ selected: autopickOn }}
              hitSlop={8}
              style={styles.autoBadge}
            >
              <Badge label="Auto" variant={autopickOn ? 'primary' : 'neutral'} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.headerTitleAbsolute} pointerEvents="none">
          <ThemedText
            type="varsity"
            style={[styles.headerText, { color: colors.secondaryText }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {isDraftComplete
              ? (isRookieDraft ? 'Rookie Draft Complete' : 'Draft Complete')
              : (isRookieDraft ? 'Rookie Draft' : 'Draft Room')}
          </ThemedText>
        </View>

        <View style={styles.headerRight}>
          {teamData?.isCommissioner && !isDraftComplete && (
            <TouchableOpacity
              onPress={() => setShowCommishControls(true)}
              accessibilityRole="button"
              accessibilityLabel="Commissioner controls"
              hitSlop={6}
              style={styles.chatIconButton}
            >
              <Ionicons name="settings-outline" size={20} color={colors.icon} />
            </TouchableOpacity>
          )}
          {teamData && (
            <TouchableOpacity
              onPress={() => setShowChat(true)}
              accessibilityRole="button"
              accessibilityLabel="Open league chat"
              hitSlop={6}
              style={styles.chatIconButton}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.icon} />
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
          </>
        )}
      </ThemedView>

      <View style={styles.content}>
        <View style={[styles.contentCap, isDesktop && styles.contentCapDesktop]}>
        {/* Pick strip stays mounted even after the draft completes so the
            last pick is visible. The completion notice renders below the
            strip as a compact banner instead of replacing it. */}
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
        {isDraftComplete && (
          <View style={[styles.completeNotice, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={[styles.completeRule, { backgroundColor: colors.gold }]} />
            <View style={styles.completeNoticeText}>
              <ThemedText
                type="varsitySmall"
                style={[styles.completeEyebrow, { color: colors.gold }]}
                accessibilityRole="header"
              >
                {isRookieDraft ? 'Rookie Draft Complete' : 'Draft Complete'}
              </ThemedText>
              <ThemedText style={[styles.completeNoticeSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
                {isRookieDraft ? 'Rookies are in.' : 'Free agency is now open.'}
              </ThemedText>
            </View>
          </View>
        )}

        {/* Paused banner — shown to everyone in the room (not just the
            commissioner) so nobody thinks the clock is broken. */}
        {draftState?.status === 'paused' && (
          <View style={[styles.completeNotice, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={[styles.completeRule, { backgroundColor: colors.gold }]} />
            <View style={styles.completeNoticeText}>
              <ThemedText
                type="varsitySmall"
                style={[styles.completeEyebrow, { color: colors.gold }]}
                accessibilityRole="header"
              >
                Draft Paused
              </ThemedText>
              <ThemedText style={[styles.completeNoticeSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
                {teamData?.isCommissioner
                  ? 'Resume from Commissioner Controls.'
                  : 'The commissioner paused the draft.'}
              </ThemedText>
            </View>
          </View>
        )}

        {isDesktop ? (
          /* Desktop live-draft layout: available players stay visible on the
             left; Queue / My Team / Trades live in a right rail switch instead
             of the mobile bottom tab bar. */
          <View style={styles.deskBody}>
            <View style={styles.deskLeft}>
              <AvailablePlayers
                draftId={draftId}
                currentPick={currentPick}
                teamId={teamData?.id || ''}
                leagueId={draftData?.league_id || ''}
                isRookieDraft={isRookieDraft}
                addToQueue={addToQueue}
                queuedPlayerIds={queuedPlayerIds}
              />
            </View>
            <View style={[styles.deskRight, { borderLeftColor: colors.border, backgroundColor: colors.background }]}>
              <View style={[styles.deskRightTabs, { borderBottomColor: colors.border }]}>
                <ToggleTab
                  label="Queue"
                  active={rightMode === 'queue'}
                  onPress={() => setViewMode('queue')}
                  colors={colors}
                />
                <ToggleTab
                  label="My Team"
                  active={rightMode === 'roster'}
                  onPress={() => setViewMode('roster')}
                  colors={colors}
                />
                {showTradeButton && (
                  <ToggleTab
                    label={myPendingCount > 0 ? `Trades (${myPendingCount})` : 'Trades'}
                    active={rightMode === 'trades'}
                    onPress={() => setViewMode('trades')}
                    colors={colors}
                  />
                )}
              </View>
              <View style={styles.deskRightBody}>
                {rightMode === 'queue' ? (
                  <DraftQueue
                    draftId={draftId}
                    leagueId={draftData?.league_id || ''}
                    teamId={teamData?.id || ''}
                    currentPick={currentPick}
                  />
                ) : rightMode === 'roster' ? (
                  <TeamRoster
                    teamId={teamData?.id || ''}
                    leagueId={draftData?.league_id || ''}
                  />
                ) : (
                  tradesPanel
                )}
              </View>
            </View>
            {showChatRail && (
              <View style={[styles.deskChat, { borderLeftColor: colors.border }]}>
                <View style={[styles.deskChatHeader, { borderBottomColor: colors.border }]}>
                  <View style={[styles.deskChatRule, { backgroundColor: colors.gold }]} />
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.deskChatTitle, { color: colors.secondaryText }]}
                    accessibilityRole="header"
                  >
                    League Chat
                  </ThemedText>
                </View>
                <LeagueChatPanel
                  leagueId={draftData?.league_id || ''}
                  teamId={teamData?.id || ''}
                  teamName={teamData?.name || ''}
                  isCommissioner={teamData?.isCommissioner ?? false}
                />
              </View>
            )}
          </View>
        ) : (
          <>
        {/* Main Content Area */}
        <View style={styles.mainContent}>
          {/* AvailablePlayers stays mounted across tab switches so its
              position/team/sort filters survive — unmounting reset them (and
              reverted CAT-league sorts back to FPTS) whenever the user dipped
              into Queue / My Team / Trades and came back. */}
          <View
            style={[styles.tabPane, viewMode !== 'players' && styles.hiddenPane]}
            pointerEvents={viewMode === 'players' ? 'auto' : 'none'}
          >
            <AvailablePlayers
              draftId={draftId}
              currentPick={currentPick}
              teamId={teamData?.id || ''}
              leagueId={draftData?.league_id || ''}
              isRookieDraft={isRookieDraft}
              addToQueue={addToQueue}
              queuedPlayerIds={queuedPlayerIds}
            />
          </View>
          {viewMode === 'queue' ? (
            <DraftQueue
              draftId={draftId}
              leagueId={draftData?.league_id || ''}
              teamId={teamData?.id || ''}
              currentPick={currentPick}
            />
          ) : viewMode === 'trades' ? (
            tradesPanel
          ) : viewMode === 'roster' ? (
            <TeamRoster
              teamId={teamData?.id || ''}
              leagueId={draftData?.league_id || ''}
            />
          ) : null}
        </View>

        {/* Bottom toggle bar — varsity caps with gold-underline active.
            Matches the within-tab filter rhythm used in ByYearTab and
            ProspectsTab so the room reads as one consistent surface. */}
        <View style={[styles.toggleContainer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <ToggleTab
            label="Players"
            active={viewMode === 'players'}
            onPress={() => setViewMode('players')}
            colors={colors}
          />
          <ToggleTab
            label="Queue"
            active={viewMode === 'queue'}
            onPress={() => setViewMode('queue')}
            colors={colors}
          />
          {showTradeButton && (
            <ToggleTab
              label={myPendingCount > 0 ? `Trades (${myPendingCount})` : 'Trades'}
              active={viewMode === 'trades'}
              onPress={() => setViewMode('trades')}
              colors={colors}
            />
          )}
          <ToggleTab
            label="My Team"
            active={viewMode === 'roster'}
            onPress={() => setViewMode('roster')}
            colors={colors}
          />
        </View>
          </>
        )}
        </View>
      </View>

      {/* Presence list — same BottomSheet treatment as the league chat
          ("Who's Here"). Online teams come from Supabase channel presence;
          offline teams aren't tracked here so the sheet shows online-only,
          which is consistent with the in-room expectation that a team is
          either subscribed to the draft channel or not. */}
      {teamData && (
        <PresenceListSheet
          visible={showPresenceList}
          onClose={() => setShowPresenceList(false)}
          entries={presenceEntries}
          myTeamId={teamData.id}
          myTeamName={teamData.name}
          myTricode={teamData.tricode ?? ''}
          teamLogoMap={presenceLogoMap}
          memberCount={draftState?.picks_per_round ?? presentTeams.length}
        />
      )}

      {showTradeModal && draftData?.league_id && teamData?.id && (
        <ProposeTradeModal
          leagueId={draftData.league_id}
          teamId={teamData.id}
          isInDraft={draftState?.status === 'in_progress'}
          onClose={() => {
            setShowTradeModal(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.tradeProposals(draftData.league_id) });
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
            queryClient.invalidateQueries({ queryKey: queryKeys.tradeProposals(draftData.league_id) });
            queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
          }}
        />
      )}

      {/* Chat is opened from the header icon (top-right). The previous
          floating FAB lived above the bottom toggle bar and competed with
          it visually, so it's been folded into the header chrome. Suppressed
          when the desktop chat rail is up — the conversation is already on
          screen, and a resize from narrow-with-chat-open would otherwise leave
          the sheet covering the rail. */}
      {draftData?.league_id && teamData?.id && (
        <DraftChatModal
          visible={showChat && !showChatRail}
          leagueId={draftData.league_id}
          teamId={teamData.id}
          teamName={teamData.name}
          isCommissioner={teamData.isCommissioner ?? false}
          onClose={() => setShowChat(false)}
        />
      )}

      {draftState && (
        <CommishDraftControlsSheet
          visible={showCommishControls}
          onClose={() => setShowCommishControls(false)}
          draftId={draftId}
          timeLimit={draftState.time_limit}
          rounds={draftState.rounds}
          accelerateAfterRound={draftState.accelerate_after_round ?? null}
          acceleratedTimeLimit={draftState.accelerated_time_limit ?? null}
          status={draftState.status}
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
    paddingHorizontal: s(8),
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    height: s(50),
    justifyContent: 'space-between',
  },
  // Applied only to the live draft header (mirrors PageHeader's clipContent):
  // clips the presence avatars' slide-down exit behind the bottom hairline.
  // Kept off the error-fallback header so a future overflowing child there
  // (e.g. a notification badge) isn't silently cropped.
  headerClip: {
    overflow: 'hidden',
  },
  // Title is absolutely centered (matches the PageHeader pattern) so the
  // right cluster's width can grow without shifting the title off-center.
  headerTitleAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  headerButton: {
    padding: s(8),
    width: s(36),
    alignItems: 'center',
  },
  autoBadge: {
    marginLeft: s(2),
  },
  // ─── Desktop header (web-only) ───────────────────────────────
  deskHeader: {
    height: 60,
    paddingHorizontal: 20,
  },
  deskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 9,
  },
  exitLabel: {
    fontSize: 12,
    letterSpacing: 0.8,
  },
  deskTitle: {
    fontFamily: Fonts.varsityBold,
    fontSize: 15,
    letterSpacing: 1.2,
  },
  deskHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  deskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  deskMetaItem: {
    alignItems: 'center',
    gap: 1,
  },
  deskMetaLabel: {
    fontSize: 9,
    letterSpacing: 1.4,
  },
  deskMetaValue: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  deskMetaRule: {
    width: StyleSheet.hairlineWidth,
    height: 22,
  },
  deskPresence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  presenceCount: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  autopickToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 9,
  },
  autopickDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  autopickLabel: {
    fontSize: 12,
    letterSpacing: 0.6,
  },
  content: {
    flex: 1,
  },
  toggleContainer: {
    flexDirection: 'row',
    paddingHorizontal: s(8),
    paddingTop: s(6),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleButton: {
    flex: 1,
    alignItems: 'center',
    paddingTop: s(8),
  },
  toggleText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
  toggleUnderline: {
    marginTop: s(6),
    height: 2,
    width: '100%',
    minWidth: s(28),
  },
  mainContent: {
    flex: 1,
  },
  // Desktop live-draft layout: available players (left) + a fixed right rail
  // for queue / my team / trades. Web-only branch; native never references it.
  // Caps the whole live-draft content (pick strip + body) to a centered column
  // so player rows read as a list instead of stretching edge-to-edge on a wide
  // monitor. flex:1 always so native (no maxWidth) still fills height.
  contentCap: {
    flex: 1,
  },
  contentCapDesktop: {
    width: '100%',
    // Wide enough for players + queue + chat side by side; past this the player
    // rows just stretch, so the room stops growing and centers.
    maxWidth: 1620,
    alignSelf: 'center',
  },
  deskBody: {
    flex: 1,
    flexDirection: 'row',
  },
  deskLeft: {
    flex: 1,
    minWidth: 0,
  },
  deskRight: {
    width: 380,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  // ─── Desktop chat rail (web ≥1440 only) ──────────────────────
  deskChat: {
    width: 340,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  deskChatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 41,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deskChatRule: {
    height: 2,
    width: 14,
  },
  deskChatTitle: {
    fontSize: 10,
    letterSpacing: 1.4,
  },
  deskRightTabs: {
    flexDirection: 'row',
    paddingHorizontal: s(8),
    paddingTop: s(6),
    paddingBottom: s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deskRightBody: {
    flex: 1,
  },
  tabPane: {
    flex: 1,
  },
  // Keeps AvailablePlayers mounted (filter state intact) while another tab is
  // shown — display:none removes it from layout so siblings fill the space.
  hiddenPane: {
    display: 'none',
  },
  // Compact completion notice — sits BELOW the pick strip so the last
  // pick stays visible. Gold rule + varsity eyebrow keeps the brand voice
  // in a single horizontal row.
  completeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(16),
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  completeRule: { height: s(20), width: 2 },
  completeNoticeText: { flex: 1 },
  completeEyebrow: { fontSize: ms(10), letterSpacing: 1.4 },
  completeNoticeSubtitle: { fontSize: ms(11), marginTop: s(1) },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  chatIconButton: {
    padding: s(4),
  },
  proposeWrap: {
    paddingHorizontal: s(12),
    paddingTop: s(12),
    paddingBottom: s(8),
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(16),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  tradeRowTitle: { fontSize: ms(14) },
  tradeRowMeta: { fontSize: ms(12), marginTop: s(2) },
  tradeRowCount: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
  },
});