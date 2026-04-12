import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { ms, s } from '@/utils/scale';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { TradeRosterPlayer, useTeamRosterForTrade } from '@/hooks/useTeamRosterForTrade';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface TradePlayerPickerProps {
  teamId: string;
  teamName: string;
  leagueId: string;
  selectedPlayerIds: string[];
  lockedPlayerIds?: Set<string>;
  pendingDropPlayerIds?: Set<string>;
  onToggle: (player: TradeRosterPlayer, avgFpts: number) => void;
  onBack: () => void;
  isCategories?: boolean;
}

export function TradePlayerPicker({
  teamId,
  teamName,
  leagueId,
  selectedPlayerIds,
  lockedPlayerIds,
  pendingDropPlayerIds,
  onToggle,
  onBack,
  isCategories,
}: TradePlayerPickerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [search, setSearch] = useState('');

  const { data: roster, isLoading } = useTeamRosterForTrade(teamId, leagueId);
  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const filtered = (roster ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const renderItem = ({ item, index }: { item: TradeRosterPlayer; index: number }) => {
    const isSelected = selectedPlayerIds.includes(item.player_id);
    const isLocked = lockedPlayerIds?.has(item.player_id) ?? false;
    const isPendingDrop = pendingDropPlayerIds?.has(item.player_id) ?? false;
    const isOnIR = item.roster_slot === 'IR';
    const isDisabled = isLocked || isOnIR || isPendingDrop;
    const fpts = scoringWeights && !isCategories ? calculateAvgFantasyPoints(item, scoringWeights) : null;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.nba_team);
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
        {/* Headshot + team pill */}
        <View style={styles.portraitWrap}>
          <View style={[styles.headshotCircle, { borderColor: c.gold, backgroundColor: c.cardAlt }]}>
            {headshotUrl ? (
              <Image source={{ uri: headshotUrl }} style={styles.headshotImg} resizeMode="cover" />
            ) : null}
          </View>
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image source={{ uri: logoUrl }} style={styles.teamPillLogo} resizeMode="contain" />
            )}
            <Text style={[styles.teamPillText, { color: c.statusText }]}>{item.nba_team}</Text>
          </View>
        </View>

        <View style={styles.info}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(4) }}>
            <ThemedText type="defaultSemiBold" style={[styles.playerName, { flexShrink: 1 }]} numberOfLines={1}>
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
              {item.avg_fga > 0
                ? ((item.avg_fgm / item.avg_fga) * 100).toFixed(1)
                : "0.0"}
              % FG · {item.avg_fta > 0
                ? ((item.avg_ftm / item.avg_fta) * 100).toFixed(1)
                : "0.0"}
              % FT · {item.avg_tov} TO
            </ThemedText>
          </View>
        ) : fpts !== null ? (
          <ThemedText style={[styles.fpts, { color: c.accent }]}>
            {fpts}
          </ThemedText>
        ) : null}
        <ThemedText style={[styles.check, { color: c.success }]}>{isSelected ? '✓' : ''}</ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backBtn}>
          <ThemedText style={[styles.backText, { color: c.accent }]}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
          {teamName} Players
        </ThemedText>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Done" onPress={onBack} style={styles.doneBtn}>
          <ThemedText style={[styles.doneText, { color: c.accent }]}>Done</ThemedText>
        </TouchableOpacity>
      </View>

      <TextInput
        accessibilityLabel="Search players"
        style={[styles.search, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
        placeholder="Search players..."
        placeholderTextColor={c.secondaryText}
        value={search}
        onChangeText={setSearch}
      />

      {isLoading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.player_id}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: s(60),
  },
  backText: {
    fontSize: ms(16),
    fontWeight: '500',
  },
  headerTitle: {
    flex: 1,
    fontSize: ms(16),
    textAlign: 'center',
  },
  doneBtn: {
    width: s(60),
    alignItems: 'flex-end',
  },
  doneText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  search: {
    margin: s(10),
    padding: s(8),
    borderRadius: 8,
    borderWidth: 1,
    fontSize: ms(14),
  },
  loader: {
    marginTop: s(20),
  },
  list: {
    paddingBottom: s(16),
  },
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
  teamPillLogo: {
    width: s(9),
    height: s(9),
  },
  teamPillText: {
    fontSize: ms(7),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
  },
  playerName: {
    fontSize: ms(14),
  },
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
  sub: {
    fontSize: ms(11),
    marginTop: s(1),
  },
  fpts: {
    fontSize: ms(13),
    fontWeight: '600',
    marginRight: s(10),
  },
  catStats: {
    alignItems: 'flex-end' as const,
    marginRight: s(10),
  },
  catStatLine: {
    fontSize: ms(11),
  },
  catSubLine: {
    fontSize: ms(9),
    marginTop: s(1),
  },
  check: {
    width: s(22),
    fontSize: ms(16),
    fontWeight: '700',
    textAlign: 'center',
  },
});
