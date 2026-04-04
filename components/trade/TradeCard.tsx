import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeItemRow, TradeProposalRow } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import { ms, s } from '@/utils/scale';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** Returns a set of item keys that are new in the counteroffer vs the original */
function getNewItemKeys(items: TradeItemRow[], originalItems?: TradeItemRow[]): Set<string> {
  if (!originalItems) return new Set();
  const origKeys = new Set(originalItems.map(itemKey));
  const newKeys = new Set<string>();
  for (const item of items) {
    const key = itemKey(item);
    if (!origKeys.has(key)) newKeys.add(key);
  }
  return newKeys;
}

function itemKey(item: TradeItemRow): string {
  if (item.player_id) return `p:${item.player_id}:${item.from_team_id}:${item.to_team_id}`;
  if (item.pick_swap_season) return `sw:${item.pick_swap_season}:${item.pick_swap_round}:${item.from_team_id}`;
  if (item.draft_pick_id) return `pk:${item.draft_pick_id}:${item.from_team_id}:${item.to_team_id}`;
  return item.id;
}

interface TradeCardProps {
  proposal: TradeProposalRow;
  onPress: () => void;
}

function getStatusColors(c: typeof Colors['light']): Record<string, string> {
  return {
    pending: c.warning,
    accepted: c.link,
    in_review: c.link,
    completed: c.success,
    rejected: c.danger,
    cancelled: c.secondaryText,
    vetoed: c.danger,
  };
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  in_review: 'In Review',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  vetoed: 'Vetoed',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function TradeCard({ proposal, onPress }: TradeCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const teamNames = proposal.teams.map((t) => t.team_name);
  const STATUS_COLORS = getStatusColors(c);
  const statusColor = STATUS_COLORS[proposal.status] ?? c.secondaryText;
  const isCounteroffer = !!proposal.counteroffer_of;
  const newItemKeys = getNewItemKeys(proposal.items, proposal.original_items);
  const summary = buildTradeReceiveSummary(proposal, newItemKeys);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${isCounteroffer ? 'Counteroffer: ' : ''}Trade: ${teamNames.join(' and ')}, ${STATUS_LABELS[proposal.status] ?? proposal.status}`}
    >
      {/* Status row */}
      <View style={styles.statusRow}>
        <View style={{ flexDirection: 'row', gap: s(6) }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={[styles.statusText, { color: c.statusText }]}>
              {STATUS_LABELS[proposal.status] ?? proposal.status}
            </Text>
          </View>
          {isCounteroffer && (
            <View style={[styles.statusBadge, { backgroundColor: c.warning }]}>
              <Text style={[styles.statusText, { color: c.statusText }]}>Counteroffer</Text>
            </View>
          )}
        </View>
        <ThemedText style={[styles.time, { color: c.secondaryText }]}>
          {formatRelativeTime(proposal.proposed_at)}
        </ThemedText>
      </View>

      {/* Teams */}
      <ThemedText type="defaultSemiBold" style={styles.teamsLine} numberOfLines={1}>
        {teamNames.join('  ↔  ')}
      </ThemedText>

      {/* Asset summary */}
      {summary.map((group, i) => (
        <View key={i} style={styles.summaryGroup}>
          <ThemedText style={[styles.summaryTeam, { color: c.text }]} numberOfLines={1}>
            {group.team} received:
          </ThemedText>
          {group.assets.map((asset, j) => (
            <View key={j} style={styles.assetRow}>
              <ThemedText
                style={[styles.summaryAsset, { color: c.secondaryText }]}
                numberOfLines={1}
              >
                {'  •  '}{asset.label}
              </ThemedText>
              {asset.isNew && (
                <View style={[styles.newBadge, { backgroundColor: c.link }]} accessibilityLabel="Newly added in counteroffer">
                  <Text style={[styles.newBadgeText, { color: c.statusText }]}>NEW</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      ))}
    </TouchableOpacity>
  );
}

interface AssetEntry { label: string; isNew: boolean }

function buildTradeReceiveSummary(
  proposal: TradeProposalRow,
  newItemKeys: Set<string>,
): { team: string; assets: AssetEntry[] }[] {
  const teamNameMap: Record<string, string> = {};
  proposal.teams.forEach((t) => {
    teamNameMap[t.team_id] = t.team_name;
  });

  const isMultiTeam = proposal.teams.length > 2;

  const receivesByTeam: Record<string, AssetEntry[]> = {};
  for (const item of proposal.items) {
    const to = teamNameMap[item.to_team_id] ?? 'Unknown';
    if (!receivesByTeam[to]) receivesByTeam[to] = [];
    const isNew = newItemKeys.has(itemKey(item));
    const fromSuffix = isMultiTeam ? ` (from ${teamNameMap[item.from_team_id] ?? '?'})` : '';
    if (item.player_name) {
      receivesByTeam[to].push({ label: item.player_name + fromSuffix, isNew });
    } else if (item.pick_swap_season && item.pick_swap_round) {
      const from = teamNameMap[item.from_team_id] ?? '?';
      receivesByTeam[to].push({ label: `Rd ${item.pick_swap_round} swap (from ${from})`, isNew });
    } else if (item.pick_season && item.pick_round) {
      const protLabel = item.protection_threshold ? ` (Top-${item.protection_threshold} P)` : '';
      receivesByTeam[to].push({ label: formatPickLabel(item.pick_season!, item.pick_round!) + protLabel + fromSuffix, isNew });
    }
  }

  return Object.entries(receivesByTeam).map(
    ([team, assets]) => ({ team, assets })
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    padding: s(14),
    marginBottom: s(10),
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(8),
  },
  statusBadge: {
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 4,
  },
  statusText: {
    fontSize: ms(11),
    fontWeight: '700',
  },
  time: {
    fontSize: ms(12),
  },
  teamsLine: {
    fontSize: ms(14),
    marginBottom: s(6),
  },
  summaryGroup: {
    marginTop: s(4),
  },
  summaryTeam: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  summaryAsset: {
    fontSize: ms(12),
    lineHeight: ms(18),
    flex: 1,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  newBadge: {
    paddingHorizontal: s(5),
    paddingVertical: s(1),
    borderRadius: 3,
    marginLeft: s(6),
  },
  newBadgeText: {
    fontSize: ms(9),
    fontWeight: '700',
  },
});
