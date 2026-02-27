import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTeamTradablePicks } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface TradablePickRow {
  id: string;
  season: string;
  round: number;
  current_team_id: string;
  original_team_id: string;
  original_team_name: string;
}

interface TradePickPickerProps {
  teamId: string;
  teamName: string;
  leagueId: string;
  selectedPickIds: string[];
  onToggle: (pick: TradablePickRow) => void;
  onBack: () => void;
}

export function TradePickPicker({
  teamId,
  teamName,
  leagueId,
  selectedPickIds,
  onToggle,
  onBack,
}: TradePickPickerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: picks, isLoading } = useTeamTradablePicks(teamId, leagueId);

  const renderItem = ({ item }: { item: TradablePickRow }) => {
    const isSelected = selectedPickIds.includes(item.id);
    const isTraded = item.current_team_id !== item.original_team_id;
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: c.border },
          isSelected && { backgroundColor: c.activeCard },
        ]}
        onPress={() => onToggle(item)}
      >
        <View style={styles.info}>
          <ThemedText type="defaultSemiBold" style={styles.pickName}>
            {formatPickLabel(item.season, item.round)}
          </ThemedText>
          {isTraded && (
            <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
              via {item.original_team_name}
            </ThemedText>
          )}
        </View>
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
          {teamName} Picks
        </ThemedText>
        <TouchableOpacity onPress={onBack} style={styles.doneBtn}>
          <ThemedText style={[styles.doneText, { color: c.accent }]}>Done</ThemedText>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (picks ?? []).length === 0 ? (
        <View style={styles.empty}>
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            No tradeable picks available
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={picks as TradablePickRow[]}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
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
  loader: {
    marginTop: 20,
  },
  empty: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
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
  pickName: {
    fontSize: 14,
  },
  sub: {
    fontSize: 11,
    marginTop: 1,
  },
check: {
    width: 22,
    fontSize: 16,
    fontWeight: '700',
    color: '#28a745',
    textAlign: 'center',
  },
});
