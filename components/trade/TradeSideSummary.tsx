import { TradeAssetRow } from '@/components/trade/TradeAssetRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeItemRow } from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

interface TradeSideSummaryProps {
  teamId: string;
  teamName: string;
  /** Items this team receives */
  receivedItems: TradeItemRow[];
  /** Player FPTS map: player_id → avg FPTS */
  playerFptsMap: Record<string, number>;
  /** Player headshot map: player_id → external_id_nba */
  playerHeadshotMap: Record<string, string | null>;
  /** Set of item keys that are new in a counteroffer */
  newItemKeys: Set<string>;
  /** Item key function */
  itemKeyFn: (item: TradeItemRow) => string;
  /** Team name map for pick swap labels */
  teamNameMap: Record<string, string>;
  /** Per-team acceptance status */
  teamStatus?: string;
  /** Whether this is a multi-team trade (shows "from Team X" on assets) */
  isMultiTeam?: boolean;
}

export function TradeSideSummary({
  teamId,
  teamName,
  receivedItems,
  playerFptsMap,
  playerHeadshotMap,
  newItemKeys,
  itemKeyFn,
  teamNameMap,
  teamStatus,
  isMultiTeam,
}: TradeSideSummaryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const statusIcon = teamStatus === 'accepted'
    ? 'checkmark-circle'
    : teamStatus === 'rejected'
      ? 'close-circle'
      : 'time-outline';

  const statusColor = teamStatus === 'accepted'
    ? c.success
    : teamStatus === 'rejected'
      ? c.danger
      : c.warning;

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`${teamName} receives ${receivedItems.length} asset${receivedItems.length !== 1 ? 's' : ''}`}
    >
      {/* Team header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <View style={styles.headerLeft}>
          <ThemedText type="defaultSemiBold" style={styles.teamName} numberOfLines={1}>
            {teamName}
          </ThemedText>
          <ThemedText style={[styles.receivesLabel, { color: c.secondaryText }]}>receives</ThemedText>
        </View>
        {teamStatus && (
          <Ionicons name={statusIcon} size={14} color={statusColor} style={styles.statusIcon} accessibilityLabel={`Status: ${teamStatus}`} />
        )}
      </View>

      {/* Assets */}
      <View style={styles.assets}>
        {receivedItems.map((item) => {
          const key = itemKeyFn(item);
          return (
            <TradeAssetRow
              key={key}
              item={item}
              avgFpts={item.player_id ? playerFptsMap[item.player_id] : undefined}
              externalIdNba={item.player_id ? playerHeadshotMap[item.player_id] : undefined}
              isNew={newItemKeys.has(key)}
              teamNameMap={teamNameMap}
              fromTeamName={isMultiTeam ? teamNameMap[item.from_team_id] : undefined}
            />
          );
        })}
        {receivedItems.length === 0 && (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>No assets</ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: s(12),
    paddingTop: s(4),
    paddingBottom: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flex: 1,
  },
  teamName: {
    fontSize: ms(13),
  },
  receivesLabel: {
    fontSize: ms(10),
    fontStyle: 'italic',
  },
  statusIcon: {
    marginTop: s(2),
    marginLeft: s(4),
  },
  assets: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
  },
  empty: {
    fontSize: ms(13),
    fontStyle: 'italic',
    paddingVertical: s(8),
  },
});
