import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Transaction, TransactionItem, useTransactions } from '@/hooks/useTransactions';
import { Ionicons } from '@expo/vector-icons';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  if (!playerName) return null;

  const toTeam = item.team_to?.name;
  const fromTeam = item.team_from?.name;

  if (fromTeam && toTeam) return `${playerName} → ${toTeam} (from ${fromTeam})`;
  if (toTeam) return `${playerName} added by ${toTeam}`;
  if (fromTeam) return `${playerName} dropped by ${fromTeam}`;
  return `${playerName} dropped`;
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

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useTransactions();

  const transactions = data?.pages.flat() ?? [];

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => {
      const icon = getTransactionIcon(item.type);
      const label = getTransactionLabel(item.type);
      const items = item.league_transaction_items ?? [];
      const descriptions = items.map(formatItemDescription).filter(Boolean) as string[];

      return (
        <View
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
          accessibilityLabel={`${label}${item.initiator ? ` by ${item.initiator.name}` : ''}, ${formatDate(item.created_at)}${descriptions.length > 0 ? `, ${descriptions.join(', ')}` : ''}`}
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
              {item.notes ? (
                <ThemedText style={[styles.notes, { color: c.secondaryText }]}>
                  {item.notes}
                </ThemedText>
              ) : descriptions.length > 0 ? (
                descriptions.map((desc, i) => (
                  <ThemedText key={i} style={[styles.notes, { color: c.secondaryText }]}>
                    {desc}
                  </ThemedText>
                ))
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
    padding: 16,
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
  footerLoader: {
    paddingVertical: 16,
  },
});
