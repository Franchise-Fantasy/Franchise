import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useTeamRosterForTrade } from '@/hooks/useTeamRosterForTrade';
import { PlayerSeasonStats } from '@/types/player';
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
  onToggle: (player: PlayerSeasonStats, avgFpts: number) => void;
  onBack: () => void;
}

export function TradePlayerPicker({
  teamId,
  teamName,
  leagueId,
  selectedPlayerIds,
  lockedPlayerIds,
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

  const renderItem = ({ item }: { item: PlayerSeasonStats }) => {
    const isSelected = selectedPlayerIds.includes(item.player_id);
    const isLocked = lockedPlayerIds?.has(item.player_id) ?? false;
    const fpts = scoringWeights ? calculateAvgFantasyPoints(item, scoringWeights) : null;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.nba_team);
    const badge = getInjuryBadge(item.status);

    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatPosition(item.position)}${isLocked ? ', in active trade' : ''}${fpts !== null ? `, ${fpts} fantasy points` : ''}`}
        accessibilityState={{ selected: isSelected, disabled: isLocked }}
        disabled={isLocked}
        style={[
          styles.row,
          { borderBottomColor: c.border },
          isSelected && { backgroundColor: c.activeCard },
          isLocked && { opacity: 0.45 },
        ]}
        onPress={() => onToggle(item, fpts ?? 0)}
      >
        {/* Headshot + team pill */}
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
            <Text style={styles.teamPillText}>{item.nba_team}</Text>
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
            {isLocked && (
              <View style={[styles.injuryBadge, { backgroundColor: '#f59e0b' }]}>
                <Text style={styles.injuryBadgeText}>IN TRADE</Text>
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
        <ThemedText style={styles.check}>{isSelected ? '✓' : ''}</ThemedText>
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
    color: '#fff',
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
    color: '#fff',
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
    color: '#28a745',
    textAlign: 'center',
  },
});
