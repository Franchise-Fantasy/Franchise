import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftPlayer } from '@/hooks/useDraftPlayer';
import { useDraftQueue , QueuedPlayer } from '@/hooks/useDraftQueue';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { ms, s } from '@/utils/scale';


interface DraftQueueProps {
  draftId: string;
  leagueId: string;
  teamId: string;
  currentPick: { id: string; current_team_id: string } | null;
}

export function DraftQueue({ draftId, leagueId, teamId, currentPick }: DraftQueueProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const sport = useActiveLeagueSport(leagueId);
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
      pro_team: item.player.pro_team,
    });
  }, [isMyTurn, currentPick, draftPlayer]);

  const renderItem = useCallback(({ item, index }: { item: QueuedPlayer; index: number }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item.player, scoringWeights)
      : undefined;
    const headshotUrl = getPlayerHeadshotUrl(item.player.external_id_nba, sport);
    const logoUrl = getTeamLogoUrl(item.player.pro_team, sport);
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
          <View style={[styles.headshotCircle, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}>
            {headshotUrl ? (
              <Image source={{ uri: headshotUrl }} style={styles.headshotImg} resizeMode="cover" />
            ) : null}
          </View>
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image source={{ uri: logoUrl }} style={styles.teamPillLogo} resizeMode="contain" />
            )}
            <Text style={[styles.teamPillText, { color: c.statusText }]}>{item.player.pro_team}</Text>
          </View>
        </View>

        {/* Player info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ flexShrink: 1, fontSize: ms(14) }}>
              {item.player.name}
            </ThemedText>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
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
              style={[styles.draftButton, { backgroundColor: isDrafting ? c.buttonDisabled : c.link }]}
              onPress={() => handleDraft(item)}
              disabled={isDrafting}
              accessibilityRole="button"
              accessibilityLabel={`Draft ${item.player.name}`}
            >
              <ThemedText style={[styles.draftButtonText, { color: c.statusText }]}>Draft</ThemedText>
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
        <LogoSpinner />
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
          <ThemedText type="defaultSemiBold" style={{ color: c.activeText, fontSize: ms(13) }}>
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
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: s(32) },
  listContent: { padding: s(8) },
  suggestedBanner: {
    padding: s(10),
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: s(24),
    fontSize: ms(13),
    fontWeight: '700',
    textAlign: 'center',
  },
  portraitWrap: {
    width: s(50),
    height: s(50),
    marginRight: s(8),
  },
  headshotCircle: {
    width: s(50),
    height: s(50),
    borderRadius: 25,
    borderWidth: 1.5,
    overflow: 'hidden' as const,
  },
  headshotImg: {
    position: 'absolute' as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(42),
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
  info: { flex: 1, marginRight: s(8) },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: s(4) },
  badge: { paddingHorizontal: s(4), paddingVertical: 1, borderRadius: 3 },
  badgeText: { fontSize: ms(8), fontWeight: '800', letterSpacing: 0.5 },
  posText: { fontSize: ms(11), marginTop: 1 },
  rightSide: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  fpts: { fontSize: ms(11), fontWeight: '600' },
  reorderButtons: { flexDirection: 'column', gap: 0 },
  arrowButton: { padding: s(2) },
  removeButton: { padding: s(2) },
  draftButton: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 4,
  },
  draftButtonText: { fontSize: ms(12), fontWeight: 'bold' },
});
