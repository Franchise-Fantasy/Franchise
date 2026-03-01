import { ThemedText } from '@/components/ThemedText';
import { PlayerGameLog as PlayerGameLogType, ScoringWeight } from '@/types/player';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { ScrollView, StyleSheet, View } from 'react-native';

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
  colors: {
    border: string;
    secondaryText: string;
    accent: string;
  };
}

export function PlayerGameLog({
  gameLog,
  isLoading,
  scoringWeights,
  upcomingGames,
  liveStats,
  liveToGameLog: liveToGameLogFn,
  formatGameInfo: formatGameInfoFn,
  colors: c,
}: PlayerGameLogProps) {

  // Build combined row list: upcoming (furthest first) -> live -> historical
  const today = new Date().toISOString().slice(0, 10);
  const hasLiveRow = liveStats && liveStats.game_status >= 2;

  const combinedRows: RowType[] = [];

  // Upcoming games (reversed so furthest is at top, nearest is closest to live/history)
  // Skip today's game if it already appears as the live row
  const filteredUpcoming = (upcomingGames ?? [])
    .filter((g) => !(hasLiveRow && g.game_date === today))
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

  // Live/final row for today
  if (liveStats && liveStats.game_status >= 2) {
    combinedRows.push({
      kind: 'live',
      key: 'live-today',
      date: formatGameDate(today),
      opp: liveStats.matchup?.replace(/^vs\s*/i, '').replace(/^@\s*/, '@') ?? '—',
      stats: liveToGameLogFn(liveStats),
      gameInfo: formatGameInfoFn(liveStats),
      isLive: liveStats.game_status === 2,
      rawDate: today,
    });
  }

  // Historical game log (skip today if already shown as live/final row)
  for (const item of (gameLog ?? [])) {
    if (hasLiveRow && item.game_date === today) continue;
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
          <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
            <ThemedText style={[styles.gameCell, styles.gameCellDate, styles.gameHeaderText, { color: c.secondaryText }]}>DATE</ThemedText>
            <ThemedText style={[styles.gameCell, styles.gameCellMatchup, styles.gameHeaderText, { color: c.secondaryText }]}>OPP</ThemedText>
          </View>
          {Array.from({ length: 12 }).map((_, i) => (
            <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
              <View style={[styles.skeletonBlock, styles.gameCellDate, { backgroundColor: c.border }]} />
              <View style={[styles.skeletonBlock, styles.gameCellMatchup, { backgroundColor: c.border }]} />
            </View>
          ))}
        </View>
        <View style={styles.scrollableStats}>
          <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
            {statColumns.map((col) => (
              <ThemedText key={col} style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>{col}</ThemedText>
            ))}
          </View>
          {Array.from({ length: 12 }).map((_, i) => (
            <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
              {statColumns.map((col) => (
                <View key={col} style={[styles.skeletonBlock, { width: 38, backgroundColor: c.border }]} />
              ))}
            </View>
          ))}
        </View>
        {scoringWeights && (
          <View style={styles.pinnedRight}>
            <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
              <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameHeaderText, { color: c.accent }]}>FPTS</ThemedText>
            </View>
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
    <View style={styles.gameLogContainer}>
      {/* Pinned left: DATE + OPP */}
      <View style={styles.pinnedLeft}>
        <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
          <ThemedText style={[styles.gameCell, styles.gameCellDate, styles.gameHeaderText, { color: c.secondaryText }]}>
            DATE
          </ThemedText>
          <ThemedText style={[styles.gameCell, styles.gameCellMatchup, styles.gameHeaderText, { color: c.secondaryText }]}>
            OPP
          </ThemedText>
        </View>
        {combinedRows.map((row) => {
          const isUpcoming = row.kind === 'upcoming';
          const isLiveRow = row.kind === 'live';
          return (
            <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, isLiveRow && styles.gameRowLive, isUpcoming && styles.gameCellDNP, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
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

      {/* Scrollable middle: all stat columns scroll as one */}
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scrollableStats}>
        <View>
          <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
            {statColumns.map((col) => (
              <ThemedText
                key={col}
                style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}
              >
                {col}
              </ThemedText>
            ))}
          </View>
          {combinedRows.map((row) => {
            if (row.kind === 'upcoming') {
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, styles.gameCellDNP, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
                  {statColumns.map((col) => (
                    <ThemedText key={col} style={[styles.gameCell, styles.gameCellDNP]}>—</ThemedText>
                  ))}
                </View>
              );
            }
            if (row.kind === 'live') {
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, styles.gameRowLive, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
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
              <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
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

      {/* Pinned right: FPTS */}
      {scoringWeights && (
        <View style={styles.pinnedRight}>
          <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
            <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameHeaderText, { color: c.accent }]}>
              FPTS
            </ThemedText>
          </View>
          {combinedRows.map((row) => {
            if (row.kind === 'upcoming') {
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, styles.gameCellDNP, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
                  <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameCellDNP]}>—</ThemedText>
                </View>
              );
            }
            if (row.kind === 'live') {
              const fpts = calculateGameFantasyPoints(row.stats as any, scoringWeights);
              return (
                <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, styles.gameRowLive, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
                  <ThemedText style={[styles.gameCell, styles.gameCellFpts, { color: c.accent, fontWeight: '600' }]}>
                    {fpts}
                  </ThemedText>
                </View>
              );
            }
            const isDNP = row.item.min === 0;
            const fpts = calculateGameFantasyPoints(row.item, scoringWeights);
            return (
              <View key={row.key} style={[styles.gameRow, { borderBottomColor: c.border }, weekBorderKeys.has(row.key) && styles.gameRowWeekEnd]}>
                <ThemedText style={[styles.gameCell, styles.gameCellFpts, isDNP ? styles.gameCellDNP : { color: c.accent, fontWeight: '600' }]}>
                  {fpts}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gameLogContainer: {
    flexDirection: 'row',
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
    fontSize: 10,
    fontWeight: '600',
  },
  gameCell: {
    width: 38,
    textAlign: 'center',
    fontSize: 13,
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
});
