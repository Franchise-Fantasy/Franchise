import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { ScoringWeight } from '@/types/player';
import { calculateGameFantasyPoints, STAT_TO_GAME, formatScore } from '@/utils/fantasyPoints';
import { RosterPlayer, round1 } from '@/components/matchup/PlayerCell';
import { LivePlayerStats, liveToGameLog } from '@/utils/nbaLive';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface TeamData {
  teamName: string;
  players: RosterPlayer[];
}

interface WeeklySummaryModalProps {
  visible: boolean;
  onClose: () => void;
  homeTeam: TeamData;
  awayTeam: TeamData | null;
  scoring: ScoringWeight[];
  weekLabel: string;
  liveMap?: Map<string, LivePlayerStats>;
}

export function WeeklySummaryModal({
  visible,
  onClose,
  homeTeam,
  awayTeam,
  scoring,
  weekLabel,
  liveMap,
}: WeeklySummaryModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDark = scheme === 'dark';

  // Build column list from scoring weights, in a readable order
  const STAT_ORDER: string[] = [
    'PTS', 'REB', 'AST', 'BLK', 'STL', 'TO',
    'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA', 'PF',
    'DD', 'TD',
  ];
  const columns = scoring
    .map((w) => ({
      label: w.stat_name,
      key: STAT_TO_GAME[w.stat_name] as string | undefined,
    }))
    .filter((col): col is { label: string; key: string } => col.key != null)
    .sort((a, b) => {
      const ai = STAT_ORDER.indexOf(a.label);
      const bi = STAT_ORDER.indexOf(b.label);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

  const screenH = Dimensions.get('window').height;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* Backdrop — tapping outside the card closes the modal */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close weekly summary"
        />

        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              maxHeight: screenH * 0.8,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.text }]}>Weekly Summary</Text>
              <Text style={[styles.weekLabel, { color: c.secondaryText }]}>{weekLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={{ color: c.secondaryText, fontSize: ms(16) }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView bounces={false} style={styles.body} nestedScrollEnabled>
            <TeamSection
              team={homeTeam}
              columns={columns}
              c={c}
              isDark={isDark}
              liveMap={liveMap}
              scoring={scoring}
            />
            {awayTeam && (
              <>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <TeamSection
                  team={awayTeam}
                  columns={columns}
                  c={c}
                  isDark={isDark}
                  liveMap={liveMap}
                  scoring={scoring}
                />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Team Section ──────────────────────────────────────────────────────────

interface TeamSectionProps {
  team: TeamData;
  columns: { label: string; key: string }[];
  c: typeof Colors.light;
  isDark: boolean;
  liveMap?: Map<string, LivePlayerStats>;
  scoring?: ScoringWeight[];
}

function TeamSection({ team, columns, c, isDark, liveMap, scoring }: TeamSectionProps) {
  // Merge live game stats into players' weekly totals
  const playersWithLive = team.players.map((p) => {
    if (!liveMap || !scoring) return p;
    const live = liveMap.get(p.player_id);
    if (!live || live.game_status < 2) return p;
    // Skip bench/IR — only active-slot players count toward weekly totals
    if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === 'DROPPED') return p;

    const liveGameLog = liveToGameLog(live);
    const liveFpts = calculateGameFantasyPoints(liveGameLog as any, scoring);

    // Merge live stats into weekGameStats
    const merged: Record<string, number> = { ...(p.weekGameStats ?? {}) };
    for (const [key, val] of Object.entries(liveGameLog)) {
      if (val == null) continue;
      const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
      merged[key] = (merged[key] ?? 0) + numVal;
    }

    return {
      ...p,
      weekPoints: round1(p.weekPoints + liveFpts),
      weekGameStats: merged,
    };
  });

  // Only show players who had active-slot games with actual minutes played
  const starters = playersWithLive
    .filter((p) => {
      if (!p.weekGameStats) return false;
      // Exclude players with no stat production (0 minutes / DNP)
      return Object.values(p.weekGameStats).some((v) => v !== 0);
    })
    .sort((a, b) => b.weekPoints - a.weekPoints);

  // Compute team totals across starters
  const totals: Record<string, number> = {};
  let totalFpts = 0;
  for (const p of starters) {
    totalFpts += p.weekPoints;
    if (p.weekGameStats) {
      for (const col of columns) {
        totals[col.key] = (totals[col.key] ?? 0) + (p.weekGameStats[col.key] ?? 0);
      }
    }
  }

  // Force the inner view wider than the container so horizontal scroll works
  const NAME_W = 110;
  const STAT_W = 38;
  const FPTS_W = 50;
  const PAD = 8; // row horizontal padding
  const tableWidth = NAME_W + columns.length * STAT_W + FPTS_W + PAD;

  return (
    <View style={styles.teamSection}>
      <Text
        style={[styles.teamName, { color: c.text }]}
        accessibilityRole="header"
      >
        {team.teamName}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator bounces={false}>
        <View style={{ minWidth: tableWidth }}>
          {/* Column headers */}
          <View style={[styles.row, styles.headerRow, { borderBottomColor: c.border }]}>
            <Text style={[styles.nameCol, styles.colHeader, { color: c.secondaryText }]}>
              Player
            </Text>
            <Text style={[styles.fptsCol, styles.colHeader, { color: c.secondaryText }]}>
              FPTS
            </Text>
            {columns.map((col) => (
              <Text
                key={col.key}
                style={[styles.statCol, styles.colHeader, { color: c.secondaryText }]}
              >
                {col.label}
              </Text>
            ))}
          </View>

          {/* Player rows */}
          {starters.map((p) => (
            <View
              key={p.player_id}
              style={[styles.row, { borderBottomColor: c.border }]}
              accessibilityLabel={`${p.name}: ${formatScore(p.weekPoints)} fantasy points, ${columns.map((col) => `${col.label} ${p.weekGameStats?.[col.key] ?? 0}`).join(', ')}`}
            >
              <Text style={[styles.nameCol, { color: c.text }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={[styles.fptsCol, { color: c.accent, fontWeight: '600' }]}>
                {formatScore(p.weekPoints)}
              </Text>
              {columns.map((col) => (
                <Text key={col.key} style={[styles.statCol, { color: c.text }]}>
                  {formatStatValue(col.key, p.weekGameStats?.[col.key] ?? 0)}
                </Text>
              ))}
            </View>
          ))}

          {/* Total row */}
          {starters.length > 0 && (
            <View
              style={[styles.row, styles.totalRow]}
              accessibilityLabel={`Team total: ${formatScore(round1(totalFpts))} fantasy points`}
            >
              <Text style={[styles.nameCol, styles.totalText, { color: c.text }]}>
                Total
              </Text>
              <Text style={[styles.fptsCol, styles.totalText, { color: c.accent }]}>
                {formatScore(round1(totalFpts))}
              </Text>
              {columns.map((col) => (
                <Text key={col.key} style={[styles.statCol, styles.totalText, { color: c.text }]}>
                  {formatStatValue(col.key, totals[col.key] ?? 0)}
                </Text>
              ))}
            </View>
          )}

          {starters.length === 0 && (
            <View style={styles.row}>
              <Text style={[styles.nameCol, { color: c.secondaryText, fontStyle: 'italic' }]}>
                No games played
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatStatValue(key: string, val: number): string {
  // Percentage-based stats aren't stored directly — all values are integers or booleans-as-counts
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(12),
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    width: '100%',
    maxWidth: s(420),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: s(16),
    paddingBottom: s(12),
  },
  title: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  weekLabel: {
    fontSize: ms(13),
    marginTop: s(2),
  },
  body: {},
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: s(16),
    marginVertical: s(8),
  },
  teamSection: {
    paddingHorizontal: s(12),
    paddingBottom: s(8),
  },
  teamName: {
    fontSize: ms(14),
    fontWeight: '700',
    marginBottom: s(6),
    paddingHorizontal: s(4),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(7),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    paddingVertical: s(4),
  },
  totalRow: {
    borderBottomWidth: 0,
    paddingTop: s(10),
    paddingBottom: s(12),
  },
  totalText: {
    fontWeight: '700',
  },
  colHeader: {
    fontSize: ms(10),
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  nameCol: {
    width: s(110),
    fontSize: ms(13),
    paddingRight: s(4),
  },
  statCol: {
    width: s(38),
    fontSize: ms(13),
    textAlign: 'center',
  },
  fptsCol: {
    width: s(50),
    fontSize: ms(13),
    textAlign: 'right',
  },
});
