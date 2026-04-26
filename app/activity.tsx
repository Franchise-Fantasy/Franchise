import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionCard } from '@/components/activity/TransactionCard';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { type Transaction, useTransactions } from '@/hooks/useTransactions';
import { ms, s } from '@/utils/scale';

const FILTER_OPTIONS = [
  { key: undefined, label: 'All' },
  { key: 'trade', label: 'Trades' },
  { key: 'waiver', label: 'Add/Drop' },
  { key: 'commissioner', label: 'Commish' },
] as const;

const SEGMENT_LABELS = FILTER_OPTIONS.map((o) => o.label);

interface DaySection {
  title: string;
  data: Transaction[];
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  );

  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';

  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const day = d.getDate();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  return `${month} ${day} · ${weekday}`;
}

function groupByDay(transactions: Transaction[]): DaySection[] {
  if (transactions.length === 0) return [];
  const sections: DaySection[] = [];
  let currentKey: string | null = null;
  let currentSection: DaySection | null = null;

  for (const txn of transactions) {
    const d = new Date(txn.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== currentKey) {
      currentSection = { title: formatDayHeader(txn.created_at), data: [] };
      sections.push(currentSection);
      currentKey = key;
    }
    currentSection!.data.push(txn);
  }
  return sections;
}

export default function Activity() {
  const c = useColors();
  const [filterIndex, setFilterIndex] = useState(0);
  const typeFilter = FILTER_OPTIONS[filterIndex].key;

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useTransactions(typeFilter);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefresh = useRef(0);

  const transactions = useMemo(() => data?.pages.flat() ?? [], [data?.pages]);
  const sections = useMemo(() => groupByDay(transactions), [transactions]);

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => <TransactionCard txn={item} />,
    [],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: DaySection }) => (
      <View style={[styles.dayHeader, { backgroundColor: c.background }]}>
        <View style={[styles.dayRule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="varsity"
          style={[styles.dayLabel, { color: c.text }]}
          accessibilityRole="header"
        >
          {section.title}
        </ThemedText>
        <View style={[styles.dayRule, { backgroundColor: c.border }]} />
      </View>
    ),
    [c],
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
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <PageHeader title="Transactions" />

      <View style={styles.filterWrap}>
        <SegmentedControl
          options={SEGMENT_LABELS}
          selectedIndex={filterIndex}
          onSelect={setFilterIndex}
          accessibilityLabel="Filter transactions by type"
        />
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
          <Ionicons
            name="document-text-outline"
            size={ms(40)}
            color={c.secondaryText}
            accessible={false}
          />
          <ThemedText
            type="display"
            style={[styles.emptyTitle, { color: c.text }]}
          >
            No moves yet.
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.emptySub, { color: c.secondaryText }]}
          >
            TRADES · ADDS · DROPS WILL LAND HERE
          </ThemedText>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          refreshing={refreshing}
          onRefresh={onRefresh}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={7}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <LogoSpinner size={18} />
              </View>
            ) : null
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
  filterWrap: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(10),
  },
  loader: {
    marginTop: s(40),
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(32),
  },
  emptyRule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: s(16),
    paddingBottom: s(24),
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingTop: s(14),
    paddingBottom: s(8),
  },
  dayRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dayLabel: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 1.4,
  },
  footerLoader: {
    paddingVertical: s(16),
  },
});
