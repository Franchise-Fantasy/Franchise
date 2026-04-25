import { useState, type RefObject } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { FptsBreakdownModal } from '@/components/player/FptsBreakdownModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { PlayerGameLog as PlayerGameLogType, ScoringWeight } from '@/types/player';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { ms, s } from "@/utils/scale";


// Returns the Monday (start of week) for a given YYYY-MM-DD date string
function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatGameDate(dateStr?: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const statColumns = [
  'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO',
  'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA', 'PF',
] as const;

function getStatValue(item: PlayerGameLogType, col: string) {
  switch (col) {
    case 'MIN': return item.min;
    case 'PTS': return item.pts;
    case 'REB': return item.reb;
    case 'AST': return item.ast;
    case 'STL': return item.stl;
    case 'BLK': return item.blk;
    case 'TO': return item.tov;
    case 'FGM': return item.fgm;
    case 'FGA': return item.fga;
    case '3PM': return item['3pm'];
    case '3PA': return item['3pa'];
    case 'FTM': return item.ftm;
    case 'FTA': return item.fta;
    case 'PF': return item.pf;
    default: return 0;
  }
}

export type UpcomingGame = {
  game_date: string;
  opponent: string;
  prefix: string;
};

type RowType =
  | { kind: 'upcoming'; key: string; date: string; opp: string; rawDate: string }
  | { kind: 'live'; key: string; date: string; opp: string; stats: Record<string, number | boolean>; gameInfo: string; isLive: boolean; rawDate: string }
  | { kind: 'history'; key: string; item: PlayerGameLogType };

interface PlayerGameLogProps {
  gameLog: PlayerGameLogType[] | undefined;
  isLoading: boolean;
  scoringWeights: ScoringWeight[] | undefined;
  upcomingGames: UpcomingGame[] | undefined;
  liveStats: { game_status: number; matchup?: string; [key: string]: any } | null;
  liveToGameLog: (stats: any) => Record<string, number | boolean>;
  formatGameInfo: (stats: any) => string;
  playerName: string;
  expanded: boolean;
  onExpand: () => void;
  isCategories?: boolean;
  bodyScrollRef?: RefObject<ScrollView | null>;
  onBodyScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  colors: {
    border: string;
    secondaryText: string;
    accent: string;
  };
}

interface PlayerGameLogHeaderProps {
  scoringWeights: ScoringWeight[] | undefined;
  isCategories?: boolean;
  headerScrollRef?: RefObject<ScrollView | null>;
  backgroundColor: string;
  colors: {
    border: string;
    secondaryText: string;
    accent: string;
  };
}

// Column-label row for the game log. Rendered as a sticky header in the
// parent ScrollView so the stat key stays visible while scrolling.
// Its horizontal ScrollView is driven externally via `headerScrollRef`
// so it stays in sync with the body's horizontal scroll.
export function PlayerGameLogHeader({
  scoringWeights,
  isCategories,
  headerScrollRef,
  backgroundColor,
  colors: c,
}: PlayerGameLogHeaderProps) {
  return (
    <View
      style={[styles.gameLogContainer, styles.stickyHeaderWrap, { backgroundColor, borderBottomColor: c.border }]}
      accessibilityLabel="Game log column headers"
    >
      <View style={styles.pinnedLeft}>
        <View style={[styles.gameRow, styles.gameHeader, styles.stickyHeaderRow]}>
          <ThemedText style={[styles.gameCell, styles.gameCellDate, styles.gameHeaderText, { color: c.secondaryText }]}>
            DATE
          </ThemedText>
          <ThemedText style={[styles.gameCell, styles.gameCellMatchup, styles.gameHeaderText, { color: c.secondaryText }]}>
            OPP
          </ThemedText>
        </View>
      </View>
      <ScrollView
        horizontal
        ref={headerScrollRef}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.scrollableStats}
      >
        <View style={[styles.gameRow, styles.gameHeader, styles.stickyHeaderRow]}>
          {statColumns.map((col) => (
            <ThemedText
              key={col}
              style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}
            >
              {col}
            </ThemedText>
          ))}
        </View>
      </ScrollView>
      {scoringWeights && !isCategories && (
        <View style={styles.pinnedRight}>
          <View style={[styles.gameRow, styles.gameHeader, styles.stickyHeaderRow]}>
            <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameHeaderText, { color: c.accent }]}>
              FPTS
            </ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

export function PlayerGameLog({
  gameLog,
  isLoading,
  scoringWeights,
  upcomingGames,
  liveStats,
  liveToGameLog: liveToGameLogFn,
  formatGameInfo: formatGameInfoFn,
  playerName,
  expanded,
  onExpand,
  isCategories,
  bodyScrollRef,
  onBodyScroll,
  colors: c,
}: PlayerGameLogProps) {
  const [breakdownData, setBreakdownData] = useState<{ stats: Record<string, number | boolean>; label: string } | null>(null);

  // Build combined row list: upcoming (furthest first) -> live -> historical
  const liveDate = liveStats?.game_date ?? null;
  const alreadyInHistory = liveDate
    ? (gameLog ?? []).some((g) => g.game_date === liveDate)
    : false;
  // Show live row if game is in progress, or final but not yet in historical data
  const showLiveRow = liveStats && liveStats.game_status >= 2 && !(liveStats.game_status === 3 && alreadyInHistory);

  const combinedRows: RowType[] = [];

  // Upcoming games (reversed so furthest is at top, nearest is closest to live/history)
  // Skip the live game's date if it already appears as the live row
  const filteredUpcoming = (upcomingGames ?? [])
    .filter((g) => !(showLiveRow && liveDate && g.game_date === liveDate))
    .slice(0, 3);
  for (let i = filteredUpcoming.length - 1; i >= 0; i--) {
    const g = filteredUpcoming[i];
    combinedRows.push({
      kind: 'upcoming',
      key: `upcoming-${g.game_date}`,
      date: formatGameDate(g.game_date),
      opp: g.prefix === '@' ? `@${g.opponent}` : g.opponent,
      rawDate: g.game_date,
    });
  }

  // Live/final row (uses game_date from live stats, not local "today")
  if (showLiveRow && liveStats && liveDate) {
    combinedRows.push({
      kind: 'live',
      key: 'live-today',
      date: formatGameDate(liveDate),
      opp: liveStats.matchup?.replace(/^vs\s*/i, '').replace(/^@\s*/, '@') ?? '—',
      stats: liveToGameLogFn(liveStats),
      gameInfo: formatGameInfoFn(liveStats),
      isLive: liveStats.game_status === 2,
      rawDate: liveDate,
    });
  }

  // Historical game log (skip the live game's date if already shown as live row)
  const historyItems = (gameLog ?? []).filter(
    (item) => !(showLiveRow && liveDate && item.game_date === liveDate),
  );
  const PREVIEW_COUNT = 4;
  const visibleHistory = expanded ? historyItems : historyItems.slice(0, PREVIEW_COUNT);
  const hasMore = !expanded && historyItems.length > PREVIEW_COUNT;
  for (const item of visibleHistory) {
    combinedRows.push({ kind: 'history', key: item.id, item });
  }

  // Thicker border between Mon-Sun week boundaries
  const rawDateOf = (r: RowType): string => r.kind === 'history' ? r.item.game_date ?? '' : r.rawDate;
  const weekBorderKeys = new Set<string>();
  for (let i = 0; i < combinedRows.length - 1; i++) {
    if (getWeekMonday(rawDateOf(combinedRows[i])) !== getWeekMonday(rawDateOf(combinedRows[i + 1]))) {
      weekBorderKeys.add(combinedRows[i].key);
    }
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <View accessibilityLabel="Loading game log" style={styles.gameLogContainer}>
        <View style={styles.pinnedLeft}>
          {Array.from({ length: 12 }).map((_, i) => (
            <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
              <View style={[styles.skeletonBlock, styles.gameCellDate, { backgroundColor: c.border }]} />
              <View style={[styles.skeletonBlock, styles.gameCellMatchup, { backgroundColor: c.border }]} />
            </View>
          ))}
        </View>
        <View style={styles.scrollableStats}>
          {Array.from({ length: 12 }).map((_, i) => (
            <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
              {statColumns.map((col) => (
                <View key={col} style={[styles.skeletonBlock, { width: 38, backgroundColor: c.border }]} />
              ))}
            </View>
          ))}
        </View>
        {scoringWeights && !isCategories && (
          <View style={styles.pinnedRight}>
            {Array.from({ length: 12 }).map((_, i) => (
              <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                <View style={[styles.skeletonBlock, { width: 44, backgroundColor: c.border }]} />
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  // Actual game log table
  return (
    <View>
    <View style={styles.gameLogContainer}>
      {/* Pinned left: DATE + OPP (header row rendered separately as sticky) */}
      <View style={styles.pinnedLeft}>
        {combinedRows.map((row, idx) => {
          const isUpcoming = row.kind === 'upcoming';
          const isLiveRow = row.kind === 'live';
          return (
            <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, isLiveRow && styles.gameRowLive, isUpcoming && styles.gameCellDNP, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
              <ThemedText style={[styles.gameCell, styles.gameCellDate, { color: c.secondaryText }]} numberOfLines={1}>
                {row.kind === 'history' ? formatGameDate(row.item.game_date) : row.date}
              </ThemedText>
              <ThemedText style={[styles.gameCell, styles.gameCellMatchup, { color: c.secondaryText }]} numberOfLines={1}>
                {row.kind === 'history'
                  ? (row.item.matchup ? row.item.matchup.replace(/^vs\s*/i, '') : '—')
                  : row.opp}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {/* Scrollable middle: all stat columns scroll as one (header is sticky, rendered by parent) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        ref={bodyScrollRef}
        onScroll={onBodyScroll}
        scrollEventThrottle={16}
        style={styles.scrollableStats}
      >
        <View>
          {combinedRows.map((row, idx) => {
            if (row.kind === 'upcoming') {
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, styles.gameCellDNP, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
                  {statColumns.map((col) => (
                    <ThemedText key={col} style={[styles.gameCell, styles.gameCellDNP]}>—</ThemedText>
                  ))}
                </View>
              );
            }
            if (row.kind === 'live') {
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, styles.gameRowLive, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
                  {statColumns.map((col) => {
                    const statKey = col === 'TO' ? 'tov' : col === '3PM' ? '3pm' : col === '3PA' ? '3pa' : col.toLowerCase();
                    const val = (row.stats as any)[statKey];
                    return (
                      <ThemedText key={col} style={styles.gameCell}>
                        {col === 'MIN' ? '—' : (val ?? 0)}
                      </ThemedText>
                    );
                  })}
                </View>
              );
            }
            const isDNP = row.item.min === 0;
            return (
              <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
                {statColumns.map((col) => (
                  <ThemedText
                    key={col}
                    style={[styles.gameCell, isDNP && styles.gameCellDNP]}
                  >
                    {getStatValue(row.item, col)}
                  </ThemedText>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Pinned right: FPTS (hidden for CAT leagues; header rendered separately as sticky) */}
      {scoringWeights && !isCategories && (
        <View style={styles.pinnedRight}>
          {combinedRows.map((row, idx) => {
            if (row.kind === 'upcoming') {
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, styles.gameCellDNP, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
                  <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameCellDNP]}>—</ThemedText>
                </View>
              );
            }
            if (row.kind === 'live') {
              const fpts = calculateGameFantasyPoints(row.stats as any, scoringWeights);
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, styles.gameRowLive, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
                  <TouchableOpacity
                    onPress={() => setBreakdownData({ stats: row.stats as Record<string, number | boolean>, label: `${row.date} ${row.opp}` })}
                    accessibilityRole="button"
                    accessibilityLabel={`View breakdown: ${fpts} fantasy points`}
                  >
                    <ThemedText style={[styles.gameCell, styles.gameCellFpts, { color: c.accent, fontWeight: '600' }]}>
                      {fpts}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              );
            }
            const isDNP = row.item.min === 0;
            const fpts = calculateGameFantasyPoints(row.item, scoringWeights);
            return (
              <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, idx % 2 === 1 && styles.gameRowAlt, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd, idx === combinedRows.length - 1 && { borderBottomWidth: 0 }]}>
                <TouchableOpacity
                  onPress={() => setBreakdownData({ stats: row.item as any, label: `${formatGameDate(row.item.game_date)} ${row.item.matchup?.replace(/^vs\s*/i, '') ?? ''}` })}
                  accessibilityRole="button"
                  accessibilityLabel={`View breakdown: ${fpts} fantasy points`}
                >
                  <ThemedText style={[styles.gameCell, styles.gameCellFpts, isDNP ? styles.gameCellDNP : { color: c.accent, fontWeight: '600' }]}>
                    {fpts}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {scoringWeights && breakdownData && (
        <FptsBreakdownModal
          visible
          onClose={() => setBreakdownData(null)}
          playerName={playerName}
          gameLabel={breakdownData.label}
          gameStats={breakdownData.stats}
          scoringWeights={scoringWeights}
        />
      )}
    </View>

    {hasMore && (
      <TouchableOpacity
        onPress={onExpand}
        accessibilityRole="button"
        accessibilityLabel="Show full game log"
        style={styles.showMoreBtn}
      >
        <ThemedText style={[styles.showMoreText, { color: c.accent }]}>
          Show More
        </ThemedText>
      </TouchableOpacity>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  gameLogContainer: {
    flexDirection: 'row',
  },
  stickyHeaderWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stickyHeaderRow: {
    borderBottomWidth: 0,
  },
  pinnedLeft: {
    flexShrink: 0,
  },
  pinnedRight: {
    flexShrink: 0,
  },
  scrollableStats: {
    flex: 1,
  },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gameHeader: {
    paddingBottom: 6,
  },
  gameHeaderText: {
    fontSize: ms(10),
    fontWeight: '600',
  },
  gameCell: {
    width: 38,
    textAlign: 'center',
    fontSize: ms(13),
    lineHeight: 18,
  },
  gameCellDate: {
    width: 42,
    textAlign: 'left',
  },
  gameCellMatchup: {
    width: 42,
    textAlign: 'left',
  },
  gameCellFpts: {
    width: 44,
  },
  gameCellDNP: {
    opacity: 0.35,
  },
  gameRowAlt: {
    backgroundColor: 'rgba(128, 128, 128, 0.09)',
  },
  gameRowLive: {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  gameRowWeekEnd: {
    borderBottomWidth: 2,
  },
  skeletonBlock: {
    height: 18,
    borderRadius: 4,
    opacity: 0.4,
  },
  showMoreBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  showMoreText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
});
