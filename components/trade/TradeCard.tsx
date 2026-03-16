import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeItemRow, TradeProposalRow } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
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

const STATUS_COLORS: Record<string, string> = {
  pending: '#f0ad4e',
  accepted: '#007AFF',
  in_review: '#007AFF',
  completed: '#28a745',
  rejected: '#dc3545',
  cancelled: '#6c757d',
  vetoed: '#dc3545',
};

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
  const statusColor = STATUS_COLORS[proposal.status] ?? c.secondaryText;
  const isCounteroffer = !!proposal.counteroffer_of;
  const newItemKeys = getNewItemKeys(proposal.items, proposal.original_items);
  const summary = buildTradeSummary(proposal, newItemKeys);

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
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>
              {STATUS_LABELS[proposal.status] ?? proposal.status}
            </Text>
          </View>
          {isCounteroffer && (
            <View style={[styles.statusBadge, { backgroundColor: '#f0ad4e' }]}>
              <Text style={styles.statusText}>Counteroffer</Text>
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
            {group.team} sends:
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
                <View style={styles.newBadge} accessibilityLabel="Newly added in counteroffer">
                  <Text style={styles.newBadgeText}>NEW</Text>
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

function buildTradeSummary(
  proposal: TradeProposalRow,
  newItemKeys: Set<string>,
): { team: string; assets: AssetEntry[] }[] {
  const teamNameMap: Record<string, string> = {};
  proposal.teams.forEach((t) => {
    teamNameMap[t.team_id] = t.team_name;
  });

  const isMultiTeam = proposal.teams.length > 2;

  const sendsByTeam: Record<string, AssetEntry[]> = {};
  for (const item of proposal.items) {
    const from = teamNameMap[item.from_team_id] ?? 'Unknown';
    if (!sendsByTeam[from]) sendsByTeam[from] = [];
    const isNew = newItemKeys.has(itemKey(item));
    const toSuffix = isMultiTeam ? ` → ${teamNameMap[item.to_team_id] ?? '?'}` : '';
    if (item.player_name) {
      sendsByTeam[from].push({ label: item.player_name + toSuffix, isNew });
    } else if (item.pick_swap_season && item.pick_swap_round) {
      const to = teamNameMap[item.to_team_id] ?? '?';
      sendsByTeam[from].push({ label: `Rd ${item.pick_swap_round} swap → ${to}`, isNew });
    } else if (item.pick_season && item.pick_round) {
      const protLabel = item.protection_threshold ? ` (Top-${item.protection_threshold} P)` : '';
      sendsByTeam[from].push({ label: formatPickLabel(item.pick_season!, item.pick_round!) + protLabel + toSuffix, isNew });
    }
  }

  return Object.entries(sendsByTeam).map(
    ([team, assets]) => ({ team, assets })
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
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
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  time: {
    fontSize: 12,
  },
  teamsLine: {
    fontSize: 14,
    marginBottom: 6,
  },
  summaryGroup: {
    marginTop: 4,
  },
  summaryTeam: {
    fontSize: 12,
    fontWeight: '600',
  },
  summaryAsset: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  newBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 6,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
});
