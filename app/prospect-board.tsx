import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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
import { CURRENT_NBA_SEASON, CURRENT_WNBA_SEASON } from '@/constants/LeagueDefaults';
import { useSession } from '@/context/AuthProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useProspectBoard, useReorderBoard } from '@/hooks/useProspectBoard';
import { useProspects } from '@/hooks/useProspects';
import { useSubscription } from '@/hooks/useSubscription';
import { ms, s } from '@/utils/scale';



// NBA seasons are dash-formatted ("2025-26"); the next draft year is the
// trailing 2-digit fragment, prefixed with "20". WNBA is single-year ("2026")
// and the next draft is just (year + 1). Other sports fall back to NBA's
// shape until they're wired through.
function getNextDraftYear(sport: string): number {
  if (sport === 'wnba') return parseInt(CURRENT_WNBA_SEASON, 10) + 1;
  return parseInt(CURRENT_NBA_SEASON.split('-')[1]!, 10) + 2000;
}

interface BoardEntry {
  playerId: string;
  name: string;
  position: string;
  school: string;
  dynastyScore: number;
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

  const DRAFT_YEARS = useMemo(() => {
    const next = getNextDraftYear(sport);
    return [`${next}`, `${next + 1}`, `${next + 2}`, `${next + 3}+`];
  }, [sport]);
  const [draftYear, setDraftYear] = useState(DRAFT_YEARS[0]);

  const { data: boardRows, isLoading: boardLoading } = useProspectBoard(userId, hasAccess);
  const { data: allProspects } = useProspects(draftYear, hasAccess);
  const { mutate: reorder } = useReorderBoard(userId);

  // Build staff ranking map from Contentful dynasty scores
  const staffRankMap = useMemo(() => {
    if (!allProspects) return new Map<string, number>();
    const sorted = [...allProspects].sort((a, b) => b.dynastyValueScore - a.dynastyValueScore);
    return new Map(sorted.map((p, i) => [p.playerId, i + 1]));
  }, [allProspects]);

  // Merge board rows with prospect data
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
          dynastyScore: prospect.dynastyValueScore,
          staffRank: staffRankMap.get(row.player_id),
        };
      })
      .filter(Boolean) as BoardEntry[];
  }, [boardRows, allProspects, staffRankMap]);

  const handleDragEnd = useCallback(
    ({ data }: { data: BoardEntry[] }) => {
      reorder(data.map(e => e.playerId));
    },
    [reorder],
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
          dynastyScore={item.dynastyScore}
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

  // Year selector — text + gold-underline active
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
  listContent: {
    paddingBottom: s(100),
    paddingTop: s(4),
  },
});
