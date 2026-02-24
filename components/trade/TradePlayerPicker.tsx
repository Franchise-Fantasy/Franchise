import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useTeamRosterForTrade } from '@/hooks/useTeamRosterForTrade';
import { PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface TradePlayerPickerProps {
  teamId: string;
  teamName: string;
  leagueId: string;
  selectedPlayerIds: string[];
  onToggle: (player: PlayerSeasonStats, avgFpts: number) => void;
  onBack: () => void;
}

export function TradePlayerPicker({
  teamId,
  teamName,
  leagueId,
  selectedPlayerIds,
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
    const fpts = scoringWeights ? calculateAvgFantasyPoints(item, scoringWeights) : null;

    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: c.border },
          isSelected && { backgroundColor: c.activeCard },
        ]}
        onPress={() => onToggle(item, fpts ?? 0)}
      >
        <View style={styles.info}>
          <ThemedText type="defaultSemiBold" style={styles.playerName} numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
            {formatPosition(item.position)} · {item.nba_team}
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
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <ThemedText style={[styles.backText, { color: c.accent }]}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
          {teamName} Players
        </ThemedText>
        <TouchableOpacity onPress={onBack} style={styles.doneBtn}>
          <ThemedText style={[styles.doneText, { color: c.accent }]}>Done</ThemedText>
        </TouchableOpacity>
      </View>

      <TextInput
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
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  info: {
    flex: 1,
  },
  playerName: {
    fontSize: 14,
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
