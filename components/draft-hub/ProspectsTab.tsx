import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { PremiumGate } from '@/components/account/PremiumGate';
import { ProspectCard } from '@/components/prospects/ProspectCard';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { getCurrentSeason, parseSeasonStartYear } from '@/constants/LeagueDefaults';
import { useSession } from '@/context/AuthProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAddToBoard, useProspectBoard } from '@/hooks/useProspectBoard';
import { useProspects } from '@/hooks/useProspects';
import { useSubscription } from '@/hooks/useSubscription';
import type { ProspectCardData } from '@/types/prospect';
import { ms, s } from '@/utils/scale';


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
  const sport = useActiveLeagueSport();

  // Next draft year is one calendar year after the current season's start year.
  // NBA '2025-26' → 2026; WNBA '2026' → 2027.
  const nextDraftYear = parseSeasonStartYear(getCurrentSeason(sport)) + 1;
  const DRAFT_YEARS = useMemo(() => [
    `${nextDraftYear}`,
    `${nextDraftYear + 1}`,
    `${nextDraftYear + 2}`,
    `${nextDraftYear + 3}+`,
  ], [nextDraftYear]);

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
      });
    } catch {
      return null;
    }
  }, [prospects]);

  const eyebrowText = lastUpdated
    ? `Staff Rankings · Updated ${lastUpdated}`
    : 'Staff Rankings';

  return (
    <PremiumGate feature="prospects" mode="teaser">
      {/* Eyebrow — gold rule + varsity caps source/freshness line.
          Replaces the floating "NBA · Dynasty Rankings" subtitle and
          "Updated …" tail; one anchor in the brand voice. */}
      <View style={styles.eyebrowRow}>
        <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrowText, { color: c.gold }]}
        >
          {eyebrowText}
        </ThemedText>
      </View>

      {/* Year selector — underline-active, Alfa Slab year. Matches the
          ByYearTab pattern so within-tab filters share one chrome. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.yearSelector}
        contentContainerStyle={styles.yearRow}
      >
        {DRAFT_YEARS.map(year => {
          const active = draftYear === year;
          return (
            <TouchableOpacity
              key={year}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${year} draft class`}
              style={styles.yearTab}
              onPress={() => setDraftYear(year)}
              activeOpacity={0.7}
            >
              <ThemedText
                style={[
                  styles.yearLabel,
                  {
                    fontFamily: active ? Fonts.display : Fonts.bodyMedium,
                    color: active ? c.text : c.secondaryText,
                  },
                ]}
              >
                {year}
              </ThemedText>
              <View
                style={[
                  styles.yearUnderline,
                  { backgroundColor: active ? c.gold : 'transparent' },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Position filter — varsity caps, gold-bold active. Lighter than
          the year row above so the visual layers stay distinct. */}
      <View style={styles.posRow}>
        {POSITIONS.map(pos => {
          const active = position === pos;
          return (
            <TouchableOpacity
              key={pos}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter by ${pos === 'All' ? 'all positions' : pos}`}
              onPress={() => setPosition(pos)}
              activeOpacity={0.7}
              hitSlop={6}
              style={styles.posTab}
            >
              <ThemedText
                type="varsity"
                style={[
                  styles.posText,
                  { color: active ? c.gold : c.secondaryText },
                ]}
              >
                {pos}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

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
  // Eyebrow — matches the Section primitive's gold rule + sectionLabel
  // rhythm at a smaller scale, since the page already has a tabs row above.
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(16),
    paddingTop: s(10),
    paddingBottom: s(6),
  },
  eyebrowRule: { height: 2, width: s(18) },
  eyebrowText: { fontSize: ms(10), letterSpacing: 1.4 },

  // Year selector — text + gold-underline active (mirrors ByYearTab)
  yearSelector: { flexGrow: 0 },
  yearRow: {
    paddingHorizontal: s(16),
    paddingTop: s(2),
    paddingBottom: s(4),
    gap: s(20),
  },
  yearTab: {
    alignItems: 'center',
    paddingTop: s(2),
  },
  yearLabel: {
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
  yearUnderline: {
    marginTop: s(4),
    height: 2,
    width: '100%',
    minWidth: s(28),
  },

  // Position filter — varsity caps, gold-bold active (lighter than year)
  posRow: {
    flexDirection: 'row',
    paddingHorizontal: s(16),
    paddingTop: s(10),
    paddingBottom: s(10),
    gap: s(16),
  },
  posTab: {
    paddingVertical: s(2),
  },
  posText: {
    fontSize: ms(12),
    letterSpacing: 1.2,
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
