import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useRef } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
} from 'react-native-draggable-flatlist';

import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { PlayerName } from '@/components/player/PlayerName';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useColors } from '@/hooks/useColors';
import { useDraftPlayer } from '@/hooks/useDraftPlayer';
import { useDraftQueue , QueuedPlayer } from '@/hooks/useDraftQueue';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueScoringType } from '@/hooks/useLeagueScoringType';
import { supabase } from '@/lib/supabase';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { getTeamLogoUrl } from '@/utils/nba/playerHeadshot';
import { checkPositionLimits, type PositionLimits } from '@/utils/roster/positionLimits';
import { ms, s } from '@/utils/scale';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';

// Fixed row height so the static rank column on the left stays aligned with
// each draggable card — same trick as ManualDraftOrderModal.
const ROW_HEIGHT = s(64);
const ROW_GAP = s(8);
// The desktop rail is ~380px wide and sits beside the pool, so the queue is a
// glance-and-compare list, not a thumb target — it gets a tighter row. Both the
// card and the static rank column read these, or the numbers drift out of step.
const DESK_ROW_HEIGHT = 46;
const DESK_ROW_GAP = 5;

interface DraftQueueProps {
  draftId: string;
  leagueId: string;
  teamId: string;
  currentPick: { id: string; current_team_id: string } | null;
}

export function DraftQueue({ draftId, leagueId, teamId, currentPick }: DraftQueueProps) {
  const c = useColors();
  const { isDesktop } = useBreakpoint();
  const rowHeight = isDesktop ? DESK_ROW_HEIGHT : ROW_HEIGHT;
  const rowGap = isDesktop ? DESK_ROW_GAP : ROW_GAP;
  const sport = useActiveLeagueSport(leagueId);
  const isMyTurn = currentPick?.current_team_id === teamId;

  const { queue, isLoading, removeFromQueue, reorderQueue } = useDraftQueue(draftId, teamId, leagueId);
  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { isCategories } = useLeagueScoringType(leagueId);
  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(leagueId, draftId);

  // Position-limit guard — mirrors AvailablePlayers so a queued player whose
  // position would push the team over a per-position cap shows a blocked Draft
  // button before the edge round-trip rejects it.
  const { data: positionLimits } = useQuery<PositionLimits | null>({
    queryKey: queryKeys.leaguePositionLimits(leagueId),
    queryFn: async () => {
      const { data } = await supabase
        .from('leagues')
        .select('position_limits')
        .eq('id', leagueId)
        .single();
      return (data?.position_limits as PositionLimits) ?? null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: myRoster } = useQuery<{ position: string; roster_slot?: string }[]>({
    // Thin position-limit shape — shares the dedicated "positions" key with
    // AvailablePlayers so it never overwrites the full-roster cache TeamRoster
    // reads. Still under the "teamRoster" prefix for broad invalidations.
    queryKey: queryKeys.teamRoster(teamId, "positions"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('position, roster_slot')
        .eq('team_id', teamId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        position: r.position,
        roster_slot: r.roster_slot ?? undefined,
      }));
    },
    enabled: !!teamId,
    staleTime: 0,
  });

  const hasLimits = !!positionLimits && Object.keys(positionLimits).length > 0;

  // Tracks the list's scroll offset so the static rank column translates in
  // lockstep (DraggableFlatList is Reanimated-backed, so the legacy onScroll
  // passthrough doesn't fire — onScrollOffsetChange is the supported hook).
  const scrollY = useRef(new Animated.Value(0)).current;

  const handleDraft = useCallback((item: QueuedPlayer) => {
    if (!isMyTurn || !currentPick) return;
    if (hasLimits) {
      const violation = checkPositionLimits(positionLimits, myRoster ?? [], item.player.position);
      if (violation) {
        Alert.alert(
          'Position limit reached',
          `Your roster already has ${violation.current} of ${violation.max} players eligible at ${violation.position}. Pick someone else.`,
        );
        return;
      }
    }
    draftPlayer({
      id: item.player_id,
      name: item.player.name,
      position: item.player.position,
      pro_team: item.player.pro_team,
    });
  }, [isMyTurn, currentPick, draftPlayer, hasLimits, positionLimits, myRoster]);

  const renderItem = useCallback(({ item, getIndex, drag, isActive }: RenderItemParams<QueuedPlayer>) => {
    const index = getIndex() ?? 0;
    const fpts = scoringWeights && !isCategories
      ? calculateAvgFantasyPoints(item.player, scoringWeights, sport)
      : undefined;
    const logoUrl = getTeamLogoUrl(item.player.pro_team, sport);
    const badge = getInjuryBadge(item.player.status);
    const isSuggested = isMyTurn && index === 0;

    const limitViolation = hasLimits
      ? checkPositionLimits(positionLimits, myRoster ?? [], item.player.position)
      : null;
    const limitBlocked = !!limitViolation;
    const draftDisabled = !isMyTurn || isDrafting || limitBlocked;

    return (
        <View
          style={[
            styles.card,
            { borderColor: c.border, backgroundColor: c.cardAlt, height: rowHeight },
            isSuggested && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
            // Contained lift while dragging — shadow instead of a scale that
            // overflows the row's clipped edges.
            isActive && styles.activeLift,
          ]}
          accessibilityLabel={`Queue position ${index + 1}, ${item.player.name}, ${formatPosition(item.player.position)}${isSuggested ? ', suggested pick' : ''}`}
        >
          {/* Player portrait. Desktop drops the round headshot: the queue is a
              short ordered list you already recognise, and in a 380px rail that
              48px medallion is the difference between 6 and 9 visible rows. */}
          <View style={[styles.portraitWrap, isDesktop && styles.portraitWrapDesktop]}>
            <View
              style={[
                styles.headshotCircle,
                isDesktop && styles.headshotCircleDesktop,
                { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
              ]}
            >
              <PlayerHeadshotImage
                externalIdNba={item.player.external_id_nba}
                sport={sport}
                style={[styles.headshotImg, isDesktop && styles.headshotImgDesktop]}
                accessible={false}
              />
            </View>
            {!isDesktop && (
              <View style={styles.teamPill}>
                {logoUrl && (
                  <Image
                    source={{ uri: logoUrl }}
                    style={styles.teamPillLogo}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    recyclingKey={logoUrl}
                    accessible={false}
                  />
                )}
                <Text style={[styles.teamPillText, { color: c.statusText }]}>{item.player.pro_team}</Text>
              </View>
            )}
          </View>

          {/* Player info */}
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <PlayerName
                name={item.player.name}
                type="defaultSemiBold"
                style={{ fontSize: ms(14) }}
                containerStyle={{ flexShrink: 1 }}
              />
              {badge && (
                <View style={[styles.badge, { backgroundColor: badge.color }]}>
                  <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
                </View>
              )}
            </View>
            <ThemedText style={[styles.posText, { color: c.secondaryText }]} numberOfLines={1}>
              {formatPosition(item.player.position)}
              {/* Desktop dropped the team pill with the portrait, so the tricode
                  moves onto the meta line rather than disappearing. */}
              {isDesktop && item.player.pro_team ? ` · ${item.player.pro_team}` : ''}
              {fpts !== undefined ? ` · ${fpts} FPTS` : ''}
            </ThemedText>
          </View>

          {/* Draft button — on every row so you can draft any queued player on
              your turn; disabled when it's not your turn or a position cap blocks it. */}
          <TouchableOpacity
            style={[
              styles.draftButton,
              isDesktop && styles.draftButtonDesktop,
              { backgroundColor: draftDisabled ? c.buttonDisabled : c.link },
            ]}
            onPress={() => handleDraft(item)}
            disabled={draftDisabled}
            accessibilityRole="button"
            accessibilityLabel={
              limitBlocked
                ? `${item.player.name} blocked — roster already has ${limitViolation.max} at ${limitViolation.position}`
                : `Draft ${item.player.name}`
            }
            accessibilityState={{ disabled: draftDisabled }}
          >
            <ThemedText style={[styles.draftButtonText, { color: draftDisabled ? c.secondaryText : c.statusText }]}>
              {limitBlocked ? `Max ${limitViolation.position}` : 'Draft'}
            </ThemedText>
          </TouchableOpacity>

          {/* Remove from queue */}
          <TouchableOpacity
            onPress={() => removeFromQueue(item.queue_id)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.player.name} from queue`}
          >
            <Ionicons name="close-circle" size={20} color={c.secondaryText} />
          </TouchableOpacity>

          {/* Drag handle — long-press to reorder. Right-edge so it doesn't
              fight scroll on the card body. */}
          <TouchableOpacity
            onLongPress={drag}
            delayLongPress={180}
            disabled={isActive}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={styles.dragHandle}
            accessibilityRole="button"
            accessibilityLabel={`Reorder ${item.player.name} — long press and drag`}
            accessibilityHint="Long press and drag to change queue position"
          >
            <Ionicons name="reorder-three" size={22} color={c.secondaryText} />
          </TouchableOpacity>
        </View>
    );
  }, [c, sport, scoringWeights, isCategories, isMyTurn, isDrafting, hasLimits, positionLimits, myRoster, handleDraft, removeFromQueue]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <LogoSpinner />
      </View>
    );
  }

  if (queue.length === 0) {
    return (
      <View style={[styles.empty, isDesktop && styles.emptyDesktop]}>
        <ThemedText style={{ color: c.secondaryText, textAlign: isDesktop ? 'left' : 'center' }}>
          No players in your queue.{'\n'}
          {/* Desktop shows the pool beside this panel, so there's no tab to
              send anyone to. */}
          {isDesktop
            ? 'Add players with + from the pool on the left.'
            : 'Add players from the Available Players tab.'}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isMyTurn && queue.length > 0 && (
        <View style={[styles.suggestedBanner, { backgroundColor: c.activeCard, borderBottomColor: c.activeBorder }]}>
          <ThemedText type="defaultSemiBold" style={{ color: c.activeText, fontSize: ms(13) }}>
            Your turn — draft any queued player below
          </ThemedText>
        </View>
      )}
      <View style={styles.boardRow}>
        {/* Static rank column — sits OUTSIDE the draggable list so the numbers
            don't drag/scale with a card; translateY tracks scroll. */}
        <Animated.View
          style={[
            styles.rankCol,
            { transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] },
          ]}
          pointerEvents="none"
        >
          {queue.map((_, i) => (
            <View key={i} style={[styles.rankSlot, { height: rowHeight, marginBottom: rowGap }]}>
              <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>{i + 1}</ThemedText>
            </View>
          ))}
        </Animated.View>

        <View style={styles.listContainer}>
          <DraggableFlatList<QueuedPlayer>
            data={queue}
            renderItem={renderItem}
            keyExtractor={(item) => item.queue_id}
            contentContainerStyle={[styles.listContent, { gap: rowGap }]}
            onScrollOffsetChange={(offset) => scrollY.setValue(offset)}
            onDragEnd={({ data }) => {
              // Skip the round-trip if order didn't change (drag started but
              // released in the same slot).
              for (let i = 0; i < data.length; i++) {
                if (data[i].queue_id !== queue[i]?.queue_id) {
                  reorderQueue(data.map((d) => d.queue_id));
                  return;
                }
              }
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: s(32) },
  // A rail is a column, not a screen — centering the copy leaves it stranded in
  // the middle of a tall void. Sit it where the first row would be.
  emptyDesktop: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  suggestedBanner: {
    padding: s(10),
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  // overflow:hidden clips the rank column as it translates upward on scroll.
  boardRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: s(8),
    paddingTop: s(8),
    gap: s(6),
    overflow: 'hidden',
  },
  rankCol: {
    width: s(18),
    flexDirection: 'column',
  },
  rankSlot: {
    height: ROW_HEIGHT,
    marginBottom: ROW_GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rank: {
    fontSize: ms(13),
    fontWeight: '700',
    textAlign: 'center',
  },
  listContainer: { flex: 1 },
  listContent: { paddingBottom: s(8), gap: ROW_GAP },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(8),
    borderRadius: 10,
    borderWidth: 1,
    gap: s(6),
  },
  activeLift: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  portraitWrap: {
    width: s(48),
    height: s(48),
    marginRight: s(4),
  },
  portraitWrapDesktop: {
    width: 30,
    height: 30,
    marginRight: 2,
  },
  headshotCircle: {
    width: s(48),
    height: s(48),
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: 'hidden' as const,
  },
  headshotCircleDesktop: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
  },
  headshotImg: {
    position: 'absolute' as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(40),
  },
  headshotImgDesktop: {
    height: 26,
    bottom: -1,
  },
  teamPill: {
    position: 'absolute',
    bottom: s(-1),
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: 1,
    gap: s(2),
  },
  teamPillLogo: { width: s(9), height: s(9) },
  teamPillText: { fontSize: ms(7), fontWeight: '700', letterSpacing: 0.3 },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: s(4) },
  badge: { paddingHorizontal: s(4), paddingVertical: 1, borderRadius: 3 },
  badgeText: { fontSize: ms(8), fontWeight: '800', letterSpacing: 0.5 },
  posText: { fontSize: ms(11), marginTop: 1 },
  draftButton: {
    minWidth: s(62),
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 4,
  },
  draftButtonDesktop: {
    minWidth: 52,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  draftButtonText: { fontSize: ms(12), fontWeight: 'bold' },
  iconButton: { padding: s(2) },
  dragHandle: { paddingVertical: s(4), paddingLeft: s(2) },
});
