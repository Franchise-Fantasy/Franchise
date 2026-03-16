import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftPlayer } from '@/hooks/useDraftPlayer';
import { useDraftQueue } from '@/hooks/useDraftQueue';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QueuedPlayer } from '@/hooks/useDraftQueue';

interface DraftQueueProps {
  draftId: string;
  leagueId: string;
  teamId: string;
  currentPick: { id: string; current_team_id: string } | null;
}

export function DraftQueue({ draftId, leagueId, teamId, currentPick }: DraftQueueProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isMyTurn = currentPick?.current_team_id === teamId;

  const { queue, isLoading, removeFromQueue, moveUp, moveDown } = useDraftQueue(draftId, teamId, leagueId);
  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(leagueId, draftId);

  const handleDraft = useCallback((item: QueuedPlayer) => {
    if (!isMyTurn || !currentPick) return;
    draftPlayer({
      id: item.player_id,
      name: item.player.name,
      position: item.player.position,
      nba_team: item.player.nba_team,
    });
  }, [isMyTurn, currentPick, draftPlayer]);

  const renderItem = useCallback(({ item, index }: { item: QueuedPlayer; index: number }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item.player, scoringWeights)
      : undefined;
    const headshotUrl = getPlayerHeadshotUrl(item.player.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.player.nba_team);
    const badge = getInjuryBadge(item.player.status);
    const isSuggested = isMyTurn && index === 0;

    return (
      <View
        style={[
          styles.row,
          { borderBottomColor: c.border },
          isSuggested && { backgroundColor: c.activeCard },
          index === queue.length - 1 && { borderBottomWidth: 0 },
        ]}
        accessibilityLabel={`Queue position ${index + 1}, ${item.player.name}, ${formatPosition(item.player.position)}${isSuggested ? ', suggested pick' : ''}`}
      >
        {/* Rank number */}
        <ThemedText style={[styles.rank, { color: c.secondaryText }]}>{index + 1}</ThemedText>

        {/* Player portrait */}
        <View style={styles.portraitWrap}>
          {headshotUrl ? (
            <Image source={{ uri: headshotUrl }} style={styles.headshot} resizeMode="cover" />
          ) : (
            <View style={[styles.headshot, { backgroundColor: c.border }]} />
          )}
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image source={{ uri: logoUrl }} style={styles.teamPillLogo} resizeMode="contain" />
            )}
            <Text style={styles.teamPillText}>{item.player.nba_team}</Text>
          </View>
        </View>

        {/* Player info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ flexShrink: 1, fontSize: 14 }}>
              {item.player.name}
            </ThemedText>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={styles.badgeText}>{badge.label}</Text>
              </View>
            )}
          </View>
          <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
            {formatPosition(item.player.position)}
          </ThemedText>
        </View>

        {/* Stats + actions */}
        <View style={styles.rightSide}>
          {fpts !== undefined && (
            <ThemedText style={[styles.fpts, { color: c.accent }]}>{fpts}</ThemedText>
          )}

          {isSuggested ? (
            <TouchableOpacity
              style={[styles.draftButton, isDrafting && styles.draftButtonDisabled]}
              onPress={() => handleDraft(item)}
              disabled={isDrafting}
              accessibilityRole="button"
              accessibilityLabel={`Draft ${item.player.name}`}
            >
              <ThemedText style={styles.draftButtonText}>Draft</ThemedText>
            </TouchableOpacity>
          ) : (
            <View style={styles.reorderButtons}>
              <TouchableOpacity
                onPress={() => moveUp(index)}
                disabled={index === 0}
                style={[styles.arrowButton, index === 0 && { opacity: 0.3 }]}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.player.name} up`}
              >
                <Ionicons name="chevron-up" size={18} color={c.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => moveDown(index)}
                disabled={index === queue.length - 1}
                style={[styles.arrowButton, index === queue.length - 1 && { opacity: 0.3 }]}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.player.name} down`}
              >
                <Ionicons name="chevron-down" size={18} color={c.text} />
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={() => removeFromQueue(item.queue_id)}
            style={styles.removeButton}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.player.name} from queue`}
          >
            <Ionicons name="close-circle" size={20} color={c.secondaryText} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [c, scoringWeights, isMyTurn, isDrafting, queue.length, handleDraft, moveUp, moveDown, removeFromQueue]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (queue.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
          No players in your queue.{'\n'}Add players from the Available Players tab.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isMyTurn && queue.length > 0 && (
        <View style={[styles.suggestedBanner, { backgroundColor: c.activeCard, borderBottomColor: c.activeBorder }]}>
          <ThemedText type="defaultSemiBold" style={{ color: c.activeText, fontSize: 13 }}>
            Your turn — top queued player highlighted below
          </ThemedText>
        </View>
      )}
      <FlatList<QueuedPlayer>
        data={queue}
        renderItem={renderItem}
        keyExtractor={(item) => item.queue_id}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  listContent: { padding: 8 },
  suggestedBanner: {
    padding: 10,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: 24,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  portraitWrap: {
    width: 44,
    height: 40,
    marginRight: 8,
  },
  headshot: {
    width: 44,
    height: 32,
    borderRadius: 4,
  },
  teamPill: {
    position: 'absolute',
    bottom: -1,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
    gap: 2,
  },
  teamPillLogo: { width: 9, height: 9 },
  teamPillText: { color: '#fff', fontSize: 7, fontWeight: '700', letterSpacing: 0.3 },
  info: { flex: 1, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  posText: { fontSize: 11, marginTop: 1 },
  rightSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fpts: { fontSize: 11, fontWeight: '600' },
  reorderButtons: { flexDirection: 'column', gap: 0 },
  arrowButton: { padding: 2 },
  removeButton: { padding: 2 },
  draftButton: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  draftButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  draftButtonDisabled: { backgroundColor: '#ccc' },
});
