import { ThemedText } from '@/components/ui/ThemedText';
import { TeamLogo } from '@/components/team/TeamLogo';
import { ms, s } from "@/utils/scale";
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Transaction, TransactionItem, useTransactions } from '@/hooks/useTransactions';
import { formatPickLabelShort } from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const FILTER_OPTIONS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: 'All' },
  { key: 'trade', label: 'Trades' },
  { key: 'waiver', label: 'Add/Drop' },
  { key: 'commissioner', label: 'Commissioner' },
];

// Waiver amber matches the waiver badge in FreeAgentList so the two screens feel like the same system.
const WAIVER_COLOR = '#D4A017';
const WAIVER_BG = '#D4A01720';

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

function getTypeColors(type: string, c: typeof Colors.light): { fg: string; bg: string } {
  switch (type) {
    case 'trade':
      return { fg: c.accent, bg: c.warningMuted };
    case 'waiver':
      return { fg: WAIVER_COLOR, bg: WAIVER_BG };
    case 'commissioner':
      return { fg: c.danger, bg: c.dangerMuted };
    default:
      return { fg: c.secondaryText, bg: c.cardAlt };
  }
}

type TeamRef = { name: string; logo_key: string | null };

function getTradeTeams(items: TransactionItem[]): TeamRef[] {
  const map = new Map<string, TeamRef>();
  for (const item of items) {
    for (const team of [item.team_from, item.team_to]) {
      if (team?.name && !map.has(team.name)) map.set(team.name, team);
    }
  }
  return Array.from(map.values());
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

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useTransactions(typeFilter);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefresh = useRef(0);

  const transactions = data?.pages.flat() ?? [];

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => {
      const icon = getTransactionIcon(item.type);
      const label = getTransactionLabel(item.type);
      const typeColors = getTypeColors(item.type, c);
      const txnItems = item.league_transaction_items ?? [];
      const isTrade = item.type === 'trade' && txnItems.length > 0;
      const tradeSummary = isTrade ? buildTradeSummary(txnItems) : [];
      const tradeTeams = isTrade ? getTradeTeams(txnItems) : [];
      const descriptions = isTrade ? [] : txnItems.map(formatItemDescription).filter(Boolean) as string[];

      // Logo cluster: for trades, show every involved team logo; otherwise use the initiator.
      const headerLogos: TeamRef[] = isTrade
        ? tradeTeams
        : item.initiator
          ? [item.initiator]
          : [];

      return (
        <View
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
          accessibilityLabel={`${label}${item.initiator ? ` by ${item.initiator.name}` : ''}, ${formatDate(item.created_at)}${isTrade ? `, ${tradeSummary.map(g => `${g.team} sends ${g.assets.join(', ')}`).join('; ')}` : descriptions.length > 0 ? `, ${descriptions.join(', ')}` : ''}`}
        >
          <View style={[styles.stripe, { backgroundColor: typeColors.fg }]} />
          <View style={styles.cardInner}>
            <View style={styles.headerRow}>
              <View style={styles.logoCluster}>
                {headerLogos.length > 0 ? (
                  headerLogos.map((team, idx) => (
                    <View key={`${team.name}-${idx}`} style={idx > 0 ? styles.logoStacked : undefined}>
                      <TeamLogo logoKey={team.logo_key} teamName={team.name} size="small" />
                    </View>
                  ))
                ) : (
                  <View style={[styles.iconCircle, { backgroundColor: typeColors.bg }]}>
                    <Ionicons name={icon} size={18} color={typeColors.fg} accessible={false} />
                  </View>
                )}
                {!isTrade && item.initiator && (
                  <ThemedText style={[styles.initiatorName, { color: c.text }]} numberOfLines={1}>
                    {item.initiator.name}
                  </ThemedText>
                )}
              </View>
              <View style={styles.headerMeta}>
                <View style={[styles.typePill, { backgroundColor: typeColors.bg }]}>
                  <Ionicons name={icon} size={12} color={typeColors.fg} accessible={false} />
                  <ThemedText style={[styles.typePillText, { color: typeColors.fg }]}>
                    {label}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.time, { color: c.secondaryText }]}>
                  {formatDate(item.created_at)}
                </ThemedText>
              </View>
            </View>

            <View style={styles.body}>
              {isTrade ? (
                tradeSummary.map((group, gi) => (
                  <View key={gi} style={styles.tradeSummaryGroup}>
                    <ThemedText style={[styles.tradeSummaryTeam, { color: c.text }]} numberOfLines={1}>
                      {group.team} sends
                    </ThemedText>
                    {group.assets.map((asset, ai) => (
                      <ThemedText key={ai} style={[styles.assetLine, { color: c.text }]} numberOfLines={1}>
                        •  {asset}
                      </ThemedText>
                    ))}
                  </View>
                ))
              ) : descriptions.length > 0 ? (
                descriptions.map((desc, i) => (
                  <ThemedText key={i} style={[styles.assetLine, { color: c.text }]}>
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

  const onRefresh = useCallback(async () => {
    if (Date.now() - lastRefresh.current < 10_000) return;
    lastRefresh.current = Date.now();
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

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
        <View style={styles.loader}><LogoSpinner /></View>
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
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListFooterComponent={
            isFetchingNextPage ? <View style={styles.footerLoader}><LogoSpinner size={18} /></View> : null
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
    fontSize: ms(15),
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  stripe: {
    width: 4,
  },
  cardInner: {
    flex: 1,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  logoCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
  },
  logoStacked: {
    marginLeft: -8,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
  },
  typePillText: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  time: {
    fontSize: ms(12),
  },
  initiatorName: {
    fontSize: ms(14),
    fontWeight: '700',
    flexShrink: 1,
  },
  body: {
    marginTop: 6,
  },
  notes: {
    fontSize: ms(13),
    lineHeight: 18,
  },
  assetLine: {
    fontSize: ms(13),
    lineHeight: 19,
  },
  tradeSummaryGroup: {
    marginTop: 6,
  },
  tradeSummaryTeam: {
    fontSize: ms(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  footerLoader: {
    paddingVertical: 16,
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
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
    fontSize: ms(13),
    fontWeight: '600',
    lineHeight: 16,
  },
});
