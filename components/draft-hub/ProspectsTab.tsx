import { ProspectCard } from '@/components/prospects/ProspectCard';
import { PremiumGate } from '@/components/PremiumGate';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useProspects } from '@/hooks/useProspects';
import { useAddToBoard, useProspectBoard } from '@/hooks/useProspectBoard';
import { useSession } from '@/context/AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { ms, s } from '@/utils/scale';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ProspectCardData } from '@/types/prospect';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

const nextDraftYear = parseInt(CURRENT_NBA_SEASON.split('-')[1]!, 10) + 2000;
const DRAFT_YEARS = [
  `${nextDraftYear}`,
  `${nextDraftYear + 1}`,
  `${nextDraftYear + 2}`,
  `${nextDraftYear + 3}+`,
];
const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C'];

export function ProspectsTab() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const session = useSession();
  const userId = session?.user?.id;
  const { canAccess, isLoading: subLoading } = useSubscription();
  // Don't fire Contentful / Supabase queries for users who can't view the data.
  // `subLoading` keeps the fetch ready-to-fire during the tier resolution flash
  // so paying users don't see an extra spinner.
  const hasAccess = subLoading || canAccess('prospects');

  const [draftYear, setDraftYear] = useState(DRAFT_YEARS[0]);
  const [position, setPosition] = useState('All');

  const { data: prospects, isLoading, refetch } = useProspects(draftYear, hasAccess);
  const { data: boardRows } = useProspectBoard(userId, hasAccess);
  const { mutate: addToBoard } = useAddToBoard(userId);

  const boardPlayerIds = useMemo(
    () => new Set((boardRows ?? []).map(r => r.player_id)),
    [boardRows],
  );

  const filtered = useMemo(() => {
    if (!prospects) return [];
    if (position === 'All') return prospects;
    return prospects.filter(p => p.position === position);
  }, [prospects, position]);

  const handleOpenProspect = useCallback(
    (p: ProspectCardData) => {
      router.push({
        pathname: '/prospect/[id]' as any,
        params: { id: p.playerId || p.contentfulEntryId },
      });
    },
    [router],
  );

  const handleAddProspectToBoard = useCallback(
    (p: ProspectCardData) => {
      if (p.playerId) addToBoard(p.playerId);
    },
    [addToBoard],
  );

  const keyExtractor = useCallback((item: ProspectCardData) => item.contentfulEntryId, []);
  const renderItem = useCallback(
    ({ item, index }: { item: ProspectCardData; index: number }) => (
      <ProspectCard
        prospect={item}
        rank={index + 1}
        onOpenProspect={handleOpenProspect}
        onAddProspectToBoard={item.playerId ? handleAddProspectToBoard : undefined}
        alreadyOnBoard={!!item.playerId && boardPlayerIds.has(item.playerId)}
      />
    ),
    [handleOpenProspect, handleAddProspectToBoard, boardPlayerIds],
  );

  const lastUpdated = useMemo(() => {
    if (!prospects?.length) return null;
    const dates = prospects
      .map(p => p.lastUpdated)
      .filter(Boolean)
      .sort()
      .reverse();
    if (!dates.length) return null;
    try {
      return new Date(dates[0]!).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return null;
    }
  }, [prospects]);

  return (
    <PremiumGate feature="prospects" mode="teaser">
      {/* Subtitle */}
      <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
        NBA · Dynasty Rankings
      </ThemedText>

      {/* Draft year tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsRow}
        contentContainerStyle={styles.tabsContent}
      >
        {DRAFT_YEARS.map(year => (
          <TouchableOpacity
            key={year}
            style={[
              styles.tab,
              { borderColor: c.border },
              draftYear === year && { backgroundColor: c.accent, borderColor: c.accent },
            ]}
            onPress={() => setDraftYear(year)}
            accessibilityRole="tab"
            accessibilityState={{ selected: draftYear === year }}
            accessibilityLabel={`${year} draft class`}
          >
            <ThemedText
              style={[
                styles.tabText,
                { color: c.secondaryText },
                draftYear === year && styles.tabTextActive,
              ]}
            >
              {year}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Position filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.posRow}
        contentContainerStyle={styles.tabsContent}
      >
        {POSITIONS.map(pos => (
          <TouchableOpacity
            key={pos}
            style={[
              styles.posTab,
              { borderColor: c.border },
              position === pos && { backgroundColor: c.cardAlt, borderColor: c.accent },
            ]}
            onPress={() => setPosition(pos)}
            accessibilityRole="tab"
            accessibilityState={{ selected: position === pos }}
            accessibilityLabel={`Filter by ${pos === 'All' ? 'all positions' : pos}`}
          >
            <ThemedText
              style={[
                styles.posText,
                { color: c.secondaryText },
                position === pos && { color: c.accent, fontWeight: '600' },
              ]}
            >
              {pos}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Staff rankings timestamp */}
      {lastUpdated && (
        <ThemedText style={[styles.updated, { color: c.secondaryText }]}>
          Staff rankings · Updated {lastUpdated}
        </ThemedText>
      )}

      {/* Prospect list */}
      {isLoading ? (
        <View style={styles.center}>
          <LogoSpinner />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={c.accent} />
          }
          contentContainerStyle={styles.listContent}
          getItemLayout={getItemLayout}
          removeClippedSubviews
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText style={{ color: c.secondaryText }}>
                No prospects found for {draftYear} class
              </ThemedText>
            </View>
          }
        />
      )}
    </PremiumGate>
  );
}

// Fixed card height = avatar (s(40)) + card padding (s(10)*2) + marginBottom (s(6)) + border (2)
// = roughly s(68) per row. Compute once since `s` is deterministic at module load.
const PROSPECT_ROW_HEIGHT = s(68);
const getItemLayout = (_: unknown, index: number) => ({
  length: PROSPECT_ROW_HEIGHT,
  offset: PROSPECT_ROW_HEIGHT * index,
  index,
});

const styles = StyleSheet.create({
  subtitle: {
    fontSize: ms(11),
    textAlign: 'center',
    marginTop: s(4),
    marginBottom: s(4),
  },
  tabsRow: { flexGrow: 0 },
  tabsContent: {
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    gap: s(6),
  },
  tab: {
    paddingHorizontal: s(14),
    paddingVertical: s(5),
    borderRadius: 20,
    borderWidth: 1,
  },
  tabText: {
    fontSize: ms(12),
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
  },
  posRow: { flexGrow: 0 },
  posTab: {
    paddingHorizontal: s(10),
    paddingVertical: s(3),
    borderRadius: 20,
    borderWidth: 1,
  },
  posText: {
    fontSize: ms(11),
  },
  updated: {
    fontSize: ms(9),
    paddingHorizontal: s(14),
    paddingBottom: s(6),
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: s(60),
  },
  listContent: {
    paddingBottom: s(100),
  },
});
