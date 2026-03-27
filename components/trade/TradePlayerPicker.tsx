import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { TradeRosterPlayer, useTeamRosterForTrade } from '@/hooks/useTeamRosterForTrade';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface TradePlayerPickerProps {
  teamId: string;
  teamName: string;
  leagueId: string;
  selectedPlayerIds: string[];
  lockedPlayerIds?: Set<string>;
  pendingDropPlayerIds?: Set<string>;
  onToggle: (player: TradeRosterPlayer, avgFpts: number) => void;
  onBack: () => void;
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
    const fpts = scoringWeights ? calculateAvgFantasyPoints(item, scoringWeights) : null;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.nba_team);
    const badge = getInjuryBadge(item.status);

    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatPosition(item.position)}${isOnIR ? ', on injured reserve' : ''}${isLocked ? ', in active trade' : ''}${isPendingDrop ? ', queued for drop' : ''}${fpts !== null ? `, ${fpts} fantasy points` : ''}`}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
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
        {fpts !== null && (
          <ThemedText style={[styles.fpts, { color: c.accent }]}>
            {fpts}
          </ThemedText>
        )}
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
        <ActivityIndicator style={styles.loader} />
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
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 60,
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    textAlign: 'center',
  },
  doneBtn: {
    width: 60,
    alignItems: 'flex-end',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
  },
  search: {
    margin: 10,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
  },
  loader: {
    marginTop: 20,
  },
  list: {
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portraitWrap: {
    width: 50,
    height: 50,
    marginRight: 8,
  },
  headshotCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    overflow: 'hidden' as const,
  },
  headshotImg: {
    position: 'absolute' as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: 42,
  },
  teamPill: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
    gap: 2,
  },
  teamPillLogo: {
    width: 9,
    height: 9,
  },
  teamPillText: {
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
  },
  playerName: {
    fontSize: 14,
  },
  injuryBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  injuryBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sub: {
    fontSize: 11,
    marginTop: 1,
  },
  fpts: {
    fontSize: 13,
    fontWeight: '600',
    marginRight: 10,
  },
  check: {
    width: 22,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
