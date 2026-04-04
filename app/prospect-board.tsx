import { ProspectBoardItem } from '@/components/prospects/ProspectBoardItem';
import { PremiumGate } from '@/components/PremiumGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useProspectBoard, useReorderBoard, useRemoveFromBoard } from '@/hooks/useProspectBoard';
import { useProspects } from '@/hooks/useProspects';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { ms, s } from '@/utils/scale';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { useSession } from '@/context/AuthProvider';

const nextDraftYear = parseInt(CURRENT_NBA_SEASON.split('-')[1]!, 10) + 2000;
const DRAFT_YEARS = [
  `${nextDraftYear}`,
  `${nextDraftYear + 1}`,
  `${nextDraftYear + 2}`,
  `${nextDraftYear + 3}+`,
];

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
  const session = useSession();
  const userId = session?.user?.id;

  const [draftYear, setDraftYear] = useState(DRAFT_YEARS[0]);

  const { data: boardRows, isLoading: boardLoading } = useProspectBoard(userId);
  const { data: allProspects } = useProspects(draftYear);
  const { mutate: reorder } = useReorderBoard(userId);
  const { mutate: removeFromBoard } = useRemoveFromBoard(userId);

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

  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<BoardEntry>) => {
      const index = getIndex() ?? 0;
      return (
        <View style={styles.rankRow}>
          <Text style={[styles.rankLabel, { color: c.tint }]}>{index + 1}</Text>
          <View style={styles.rankCard}>
            <ProspectBoardItem
              name={item.name}
              position={item.position}
              school={item.school}
              dynastyScore={item.dynastyScore}
              staffRank={item.staffRank}
              userRank={index + 1}
              drag={drag}
              isActive={isActive}
            />
          </View>
        </View>
      );
    },
    [c.tint],
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="My Board" />

      <PremiumGate feature="prospect_board" mode="teaser">
        <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
          Drag to set your personal rankings
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

        {/* Board header */}
        <View style={styles.headerRow}>
          <ThemedText type="defaultSemiBold" style={[styles.yourRankings, { color: c.text }]}>
            YOUR RANKINGS
          </ThemedText>
          <ThemedText style={[styles.vsStaff, { color: c.secondaryText }]}>
            vs staff
          </ThemedText>
        </View>

        {boardLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.accent} />
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: s(16),
    marginTop: s(4),
    marginBottom: s(8),
  },
  yourRankings: {
    fontSize: ms(11),
    letterSpacing: 0.5,
  },
  vsStaff: {
    fontSize: ms(10),
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: s(12),
  },
  rankLabel: {
    fontSize: ms(16),
    fontWeight: '700',
    width: s(26),
    textAlign: 'center',
  },
  rankCard: {
    flex: 1,
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
