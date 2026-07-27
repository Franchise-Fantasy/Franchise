import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PremiumGate } from '@/components/account/PremiumGate';
import { ProspectBoardItem } from '@/components/prospects/ProspectBoardItem';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useSession } from '@/context/AuthProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useNextRookieDraftYear } from '@/hooks/useNextRookieDraftYear';
import { useProspectBoard, useReorderBoard } from '@/hooks/useProspectBoard';
import { useProspects } from '@/hooks/useProspects';
import { useSubscription } from '@/hooks/useSubscription';
import { ms, s } from '@/utils/scale';


interface BoardEntry {
  playerId: string;
  name: string;
  position: string;
  school: string;
  staffRank?: number;
}

export default function ProspectBoardScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const session = useSession();
  const userId = session?.user?.id;
  const sport = useActiveLeagueSport();
  const { canAccess, isLoading: subLoading } = useSubscription();
  const hasAccess = subLoading || canAccess('prospect_board');

  const nextDraftYear = useNextRookieDraftYear(sport);
  const DRAFT_YEARS = useMemo(() => [
    `${nextDraftYear}`,
    `${nextDraftYear + 1}`,
    `${nextDraftYear + 2}`,
    `${nextDraftYear + 3}+`,
  ], [nextDraftYear]);
  const [draftYear, setDraftYear] = useState(DRAFT_YEARS[0]);

  // DRAFT_YEARS[0] starts from a global fallback and corrects to the active
  // league's actual offseason state once useNextRookieDraftYear's query
  // resolves. Keep the selected tab following that correction until the
  // user explicitly picks a year themselves.
  const yearManuallySelected = useRef(false);
  useEffect(() => {
    if (!yearManuallySelected.current) setDraftYear(DRAFT_YEARS[0]);
  }, [DRAFT_YEARS]);

  const handleSelectDraftYear = useCallback((year: string) => {
    yearManuallySelected.current = true;
    setDraftYear(year);
  }, []);

  const { data: boardRows, isLoading: boardLoading } = useProspectBoard(userId, hasAccess);
  const { data: allProspects } = useProspects(draftYear, hasAccess);
  const { mutate: reorder } = useReorderBoard(userId);

  // Merge board rows with prospect data. Staff rank is the consensus
  // display_rank straight off the prospect_board (no longer re-derived).
  const boardEntries: BoardEntry[] = useMemo(() => {
    if (!boardRows || !allProspects) return [];

    const prospectMap = new Map(
      allProspects.map(p => [p.playerId, p]),
    );

    return boardRows
      .map(row => {
        const prospect = prospectMap.get(row.player_id);
        if (!prospect) return null;
        return {
          playerId: row.player_id,
          name: prospect.name,
          position: prospect.position,
          school: prospect.school,
          staffRank: prospect.displayRank,
        };
      })
      .filter(Boolean) as BoardEntry[];
  }, [boardRows, allProspects]);

  // The board is one global ranking, but this screen only ever shows a single
  // draft class. Splice the reordered subset back into the full board at the
  // slots it already occupied — passing just the visible ids would renumber
  // them 1..N and collide with (or leapfrog) every other class's ranks.
  const handleDragEnd = useCallback(
    ({ data }: { data: BoardEntry[] }) => {
      const moved = data.map(e => e.playerId);
      const visible = new Set(moved);
      let next = 0;
      const fullOrder = (boardRows ?? []).map(row =>
        visible.has(row.player_id) ? moved[next++] : row.player_id,
      );
      reorder(fullOrder);
    },
    [boardRows, reorder],
  );

  const handleOpenProspect = useCallback(
    (playerId: string) => {
      router.push({
        pathname: '/prospect/[id]' as any,
        params: { id: playerId },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<BoardEntry>) => {
      const index = getIndex() ?? 0;
      return (
        <ProspectBoardItem
          rank={index + 1}
          playerId={item.playerId}
          name={item.name}
          position={item.position}
          school={item.school}
          staffRank={item.staffRank}
          userRank={index + 1}
          drag={drag}
          isActive={isActive}
          onPressItem={handleOpenProspect}
        />
      );
    },
    [handleOpenProspect],
  );

  const eyebrowText = boardEntries.length
    ? `My Rankings · ${boardEntries.length} ${boardEntries.length === 1 ? 'Prospect' : 'Prospects'}`
    : 'My Rankings';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="My Board" />

      <PremiumGate feature="prospect_board" mode="teaser">
        {/* Eyebrow — gold rule + varsity caps. Replaces the floating subtitle
            and the "YOUR RANKINGS / vs staff" header row. */}
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrowText, { color: c.gold }]}
          >
            {eyebrowText}
          </ThemedText>
          <View style={{ flex: 1 }} />
          <ThemedText type="varsitySmall" style={[styles.vsStaff, { color: c.secondaryText }]}>
            vs Staff
          </ThemedText>
        </View>

        {/* Year selector — underline-active (matches ByYearTab + ProspectsTab) */}
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
                onPress={() => handleSelectDraftYear(year)}
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

        <ThemedText style={[styles.helperText, { color: c.secondaryText }]}>
          Drag to set your rankings.
        </ThemedText>

        {boardLoading ? (
          <View style={styles.center}>
            <LogoSpinner />
          </View>
        ) : boardEntries.length === 0 ? (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText, textAlign: 'center', paddingHorizontal: s(32) }}>
              Your board is empty. Add prospects from the Prospects hub to build your personal rankings.
            </ThemedText>
          </View>
        ) : (
          <DraggableFlatList
            // `style` lands on the INNER FlatList; the library's own wrapper
            // View only takes `containerStyle` and carries no default flex. So
            // a bare style={flex:1} left the wrapper auto-sized around a
            // flex-1 child, collapsing the whole list to zero height — the
            // board looked empty even with entries in it. Flex both.
            containerStyle={styles.list}
            style={styles.list}
            data={boardEntries}
            keyExtractor={item => item.playerId}
            renderItem={renderItem}
            onDragEnd={handleDragEnd}
            contentContainerStyle={styles.listContent}
          />
        )}
      </PremiumGate>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // Eyebrow — matches Section primitive's gold rule + sectionLabel rhythm
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(6),
  },
  eyebrowRule: { height: 2, width: s(18) },
  eyebrowText: { fontSize: ms(10), letterSpacing: 1.4 },
  vsStaff: { fontSize: ms(10), letterSpacing: 1.2 },

  // Year selector — text + gold-underline active. flexShrink:0 so a long board
  // list can't vertically compress this row and clip the Alfa Slab year digits.
  yearSelector: { flexGrow: 0, flexShrink: 0 },
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

  helperText: {
    fontSize: ms(11),
    paddingHorizontal: s(16),
    paddingTop: s(6),
    paddingBottom: s(8),
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: s(60),
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: s(100),
    paddingTop: s(4),
  },
});
