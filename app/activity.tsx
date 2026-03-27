import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Transaction, TransactionItem, useTransactions } from '@/hooks/useTransactions';
import { formatPickLabelShort } from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const FILTER_OPTIONS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: 'All' },
  { key: 'trade', label: 'Trades' },
  { key: 'waiver', label: 'Add/Drop' },
  { key: 'commissioner', label: 'Commissioner' },
];

function getTransactionIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'trade':
      return 'swap-horizontal';
    case 'waiver':
      return 'person-add';
    case 'commissioner':
      return 'shield';
    default:
      return 'document-text';
  }
}

function getTransactionLabel(type: string): string {
  switch (type) {
    case 'trade':
      return 'Trade';
    case 'waiver':
      return 'Add/Drop';
    case 'commissioner':
      return 'Commissioner';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

function formatItemDescription(item: TransactionItem): string | null {
  const playerName = item.player?.name;
  if (!playerName && !item.draft_pick) return null;

  const assetName = playerName ?? (item.draft_pick ? formatPickLabelShort(item.draft_pick.season, item.draft_pick.round) : null);
  if (!assetName) return null;

  const toTeam = item.team_to?.name;
  const fromTeam = item.team_from?.name;

  if (fromTeam && toTeam) return `${assetName} → ${toTeam} (from ${fromTeam})`;
  if (toTeam) return `${assetName} added by ${toTeam}`;
  if (fromTeam) return `${assetName} dropped by ${fromTeam}`;
  return `${assetName} dropped`;
}

function buildTradeSummary(items: TransactionItem[]): { team: string; assets: string[] }[] {
  // Count unique sending teams to detect multi-team trades
  const uniqueFromTeams = new Set(items.map((i) => i.team_from_id).filter(Boolean));
  const isMultiTeam = uniqueFromTeams.size > 2;

  const sendsByTeam: Record<string, string[]> = {};
  for (const item of items) {
    const from = item.team_from?.name ?? 'Unknown';
    if (!sendsByTeam[from]) sendsByTeam[from] = [];
    const toSuffix = isMultiTeam && item.team_to?.name ? ` → ${item.team_to.name}` : '';
    if (item.player?.name) {
      sendsByTeam[from].push(item.player.name + toSuffix);
    } else if (item.draft_pick) {
      sendsByTeam[from].push(formatPickLabelShort(item.draft_pick.season, item.draft_pick.round) + toSuffix);
    }
  }
  return Object.entries(sendsByTeam).map(([team, assets]) => ({ team, assets }));
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Activity() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useTransactions(typeFilter);

  const transactions = data?.pages.flat() ?? [];

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => {
      const icon = getTransactionIcon(item.type);
      const label = getTransactionLabel(item.type);
      const txnItems = item.league_transaction_items ?? [];
      const isTrade = item.type === 'trade' && txnItems.length > 0;
      const tradeSummary = isTrade ? buildTradeSummary(txnItems) : [];
      const descriptions = isTrade ? [] : txnItems.map(formatItemDescription).filter(Boolean) as string[];

      return (
        <View
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
          accessibilityLabel={`${label}${item.initiator ? ` by ${item.initiator.name}` : ''}, ${formatDate(item.created_at)}${isTrade ? `, ${tradeSummary.map(g => `${g.team} sends ${g.assets.join(', ')}`).join('; ')}` : descriptions.length > 0 ? `, ${descriptions.join(', ')}` : ''}`}
        >
          <View style={styles.cardRow}>
            <View style={[styles.iconCircle, { backgroundColor: c.cardAlt }]}>
              <Ionicons name={icon} size={18} color={c.accent} accessible={false} />
            </View>
            <View style={styles.cardContent}>
              <View style={styles.cardHeader}>
                <ThemedText style={styles.typeLabel}>
                  {label}{item.initiator ? ` · ${item.initiator.name}` : ''}
                </ThemedText>
                <ThemedText style={[styles.time, { color: c.secondaryText }]}>
                  {formatDate(item.created_at)}
                </ThemedText>
              </View>
              {isTrade ? (
                tradeSummary.map((group, gi) => (
                  <View key={gi} style={styles.tradeSummaryGroup}>
                    <ThemedText style={[styles.tradeSummaryTeam, { color: c.text }]} numberOfLines={1}>
                      {group.team} sends:
                    </ThemedText>
                    {group.assets.map((asset, ai) => (
                      <ThemedText key={ai} style={[styles.notes, { color: c.secondaryText }]} numberOfLines={1}>
                        {'  •  '}{asset}
                      </ThemedText>
                    ))}
                  </View>
                ))
              ) : descriptions.length > 0 ? (
                descriptions.map((desc, i) => (
                  <ThemedText key={i} style={[styles.notes, { color: c.secondaryText }]}>
                    {desc}
                  </ThemedText>
                ))
              ) : item.notes ? (
                <ThemedText style={[styles.notes, { color: c.secondaryText }]}>
                  {item.notes}
                </ThemedText>
              ) : null}
            </View>
          </View>
        </View>
      );
    },
    [c]
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Transactions" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = typeFilter === opt.key;
          return (
            <Pressable
              key={opt.label}
              onPress={() => setTypeFilter(opt.key)}
              style={[
                styles.filterChip,
                { borderColor: active ? c.accent : c.border, backgroundColor: active ? c.accent : c.card },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter by ${opt.label}`}
            >
              <ThemedText style={[styles.filterChipText, { color: active ? '#fff' : c.text }]}>
                {opt.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : transactions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={40} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            No transactions yet
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator style={styles.footerLoader} /> : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loader: {
    marginTop: 40,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
  },
  list: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
  },
  notes: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  tradeSummaryGroup: {
    marginTop: 4,
  },
  tradeSummaryTeam: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerLoader: {
    paddingVertical: 16,
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 16,
  },
});
