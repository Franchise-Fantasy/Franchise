import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { TradeRosterPlayer, useTeamRosterForTrade } from '@/hooks/useTeamRosterForTrade';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl, PLAYER_SILHOUETTE } from '@/utils/nba/playerHeadshot';
import { ms, s } from '@/utils/scale';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';

interface TradePlayerPickerBodyProps {
  teamId: string;
  leagueId: string;
  selectedPlayerIds: string[];
  lockedPlayerIds?: Set<string>;
  pendingDropPlayerIds?: Set<string>;
  onToggle: (player: TradeRosterPlayer, avgFpts: number) => void;
  isCategories?: boolean;
  /** Controlled search query — lifted to caller so collapse/reopen retains it. */
  search: string;
  onSearchChange: (q: string) => void;
}

/**
 * The interactive body of the player picker: search input + roster list +
 * per-row state badges (selected / IR / locked-in-other-trade / pending-drop).
 *
 * Extracted so two surfaces can compose it:
 * - The full-screen `TradePlayerPicker` (header + this body).
 * - The inline picker reveal in the upcoming `TradeFloor` rework, where
 *   the body lives directly under a team's lane chip row with a tighter
 *   header and capped maxHeight.
 *
 * Search is controlled (passed in) so the caller can persist queries
 * across collapse/reopen — important for the inline-reveal pattern.
 */
export function TradePlayerPickerBody({
  teamId,
  leagueId,
  selectedPlayerIds,
  lockedPlayerIds,
  pendingDropPlayerIds,
  onToggle,
  isCategories,
  search,
  onSearchChange,
}: TradePlayerPickerBodyProps) {
  const c = useColors();
  const sport = useActiveLeagueSport(leagueId);

  const { data: roster, isLoading } = useTeamRosterForTrade(teamId, leagueId);
  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const filtered = (roster ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const renderItem = ({ item, index }: { item: TradeRosterPlayer; index: number }) => {
    const isSelected = selectedPlayerIds.includes(item.player_id);
    const isLocked = lockedPlayerIds?.has(item.player_id) ?? false;
    const isPendingDrop = pendingDropPlayerIds?.has(item.player_id) ?? false;
    const isOnIR = item.roster_slot === 'IR';
    const isDisabled = isLocked || isOnIR || isPendingDrop;
    const fpts = scoringWeights && !isCategories ? calculateAvgFantasyPoints(item, scoringWeights) : null;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba, sport);
    const logoUrl = getTeamLogoUrl(item.pro_team, sport);
    const badge = getInjuryBadge(item.status);

    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatPosition(item.position)}${isOnIR ? ', on injured reserve' : ''}${isLocked ? ', in active trade' : ''}${isPendingDrop ? ', queued for drop' : ''}${fpts !== null ? `, ${fpts} fantasy points` : ''}${isCategories ? `, ${item.avg_pts} points, ${item.avg_reb} rebounds, ${item.avg_ast} assists, ${item.avg_stl} steals, ${item.avg_blk} blocks` : ''}`}
        accessibilityState={{ selected: isSelected, disabled: isDisabled }}
        disabled={isDisabled}
        style={[
          styles.row,
          { borderBottomColor: c.border },
          isSelected && { backgroundColor: c.activeCard },
          isDisabled && { opacity: 0.45 },
          index === filtered.length - 1 && { borderBottomWidth: 0 },
        ]}
        onPress={() => onToggle(item, fpts ?? 0)}
      >
        <View style={styles.portraitWrap}>
          <View style={[styles.headshotCircle, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}>
            <Image
              source={headshotUrl ? { uri: headshotUrl } : PLAYER_SILHOUETTE}
              style={styles.headshotImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={headshotUrl ?? 'silhouette'}
              placeholder={PLAYER_SILHOUETTE}
            />
          </View>
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image
                source={{ uri: logoUrl }}
                style={styles.teamPillLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={logoUrl}
              />
            )}
            <Text style={[styles.teamPillText, { color: c.statusText }]}>{item.pro_team}</Text>
          </View>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText
              type="defaultSemiBold"
              style={[styles.playerName, { flexShrink: 1 }]}
              numberOfLines={1}
            >
              {item.name}
            </ThemedText>
            {badge && (
              <View style={[styles.injuryBadge, { backgroundColor: badge.color }]}>
                <Text style={styles.injuryBadgeText}>{badge.label}</Text>
              </View>
            )}
            {isOnIR && (
              <View style={[styles.injuryBadge, { backgroundColor: c.danger }]}>
                <Text style={[styles.injuryBadgeText, { color: c.statusText }]}>IR</Text>
              </View>
            )}
            {isLocked && (
              <View style={[styles.injuryBadge, { backgroundColor: c.warning }]}>
                <Text style={[styles.injuryBadgeText, { color: c.statusText }]}>IN TRADE</Text>
              </View>
            )}
            {isPendingDrop && (
              <View style={[styles.injuryBadge, { backgroundColor: c.danger }]}>
                <Text style={[styles.injuryBadgeText, { color: c.statusText }]}>QUEUED DROP</Text>
              </View>
            )}
          </View>
          <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
            {formatPosition(item.position)}
          </ThemedText>
        </View>
        {isCategories ? (
          <View style={styles.catStats}>
            <ThemedText style={[styles.catStatLine, { color: c.secondaryText }]}>
              {item.avg_pts}/{item.avg_reb}/{item.avg_ast}/{item.avg_stl}/{item.avg_blk}
            </ThemedText>
            <ThemedText style={[styles.catSubLine, { color: c.secondaryText }]}>
              {item.avg_fga > 0 ? ((item.avg_fgm / item.avg_fga) * 100).toFixed(1) : '0.0'}% FG ·{' '}
              {item.avg_fta > 0 ? ((item.avg_ftm / item.avg_fta) * 100).toFixed(1) : '0.0'}% FT ·{' '}
              {item.avg_tov} TO
            </ThemedText>
          </View>
        ) : fpts !== null ? (
          <ThemedText style={[styles.fpts, { color: c.gold }]}>{fpts}</ThemedText>
        ) : null}
        {isSelected ? (
          <Ionicons name="checkmark-circle" size={20} color={c.gold} accessible={false} />
        ) : (
          <View style={styles.checkSpacer} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel="Search players"
        style={[styles.search, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
        placeholder="Search players..."
        placeholderTextColor={c.secondaryText}
        value={search}
        onChangeText={onSearchChange}
      />

      {isLoading ? (
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.player_id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: {
    margin: s(10),
    padding: s(8),
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: ms(14),
  },
  loader: { marginTop: s(20) },
  list: { paddingBottom: s(16) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    bottom: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: s(1),
    gap: s(2),
  },
  teamPillLogo: { width: s(9), height: s(9) },
  teamPillText: {
    fontSize: ms(7),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  info: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  playerName: { fontSize: ms(14) },
  injuryBadge: {
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    borderRadius: 3,
  },
  injuryBadgeText: {
    fontSize: ms(8),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sub: { fontSize: ms(11), marginTop: s(1) },
  fpts: {
    fontSize: ms(13),
    fontWeight: '600',
    marginRight: s(10),
  },
  catStats: {
    alignItems: 'flex-end' as const,
    marginRight: s(10),
  },
  catStatLine: { fontSize: ms(11) },
  catSubLine: { fontSize: ms(9), marginTop: s(1) },
  checkSpacer: { width: s(20) },
});
