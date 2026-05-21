import { Ionicons } from '@expo/vector-icons';
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

import { RosterPlayer, round1 } from '@/components/matchup/PlayerCell';
import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ScoringWeight } from '@/types/player';
import { abbreviateFirstName } from '@/utils/formatting';
import { LivePlayerStats, liveToGameLog } from '@/utils/nba/nbaLive';
import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';
import { ms, s } from '@/utils/scale';
import { calculateGameFantasyPoints, formatScore, STAT_TO_GAME } from '@/utils/scoring/fantasyPoints';

// Box-score column widths. Lifted to constants so the inner content view
// can compute its minimum width and force the horizontal ScrollView to
// engage when columns add up to more than the visible track.
const NAME_W = s(110);
const FPTS_W = s(54);
const STAT_W = s(36);
const ROW_PAD = s(8);

interface TeamData {
  teamName: string;
  tricode?: string | null;
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
  const c = useColors();

  // Build the stat-column list in a readable order (PTS first, percentage
  // counters last). Filtered to stats the league actually scores.
  const STAT_ORDER: string[] = [
    'PTS', 'REB', 'AST', 'BLK', 'STL', 'TO',
    '3PM', '3PA', 'FGM', 'FGA', 'FTM', 'FTA', 'PF',
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
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close weekly summary"
      >
        {/* Card stops scrim presses from registering as outside taps. A
            no-op `onPress` Pressable is enough — Pressable consumes the
            touch via the responder system only on tap-end (not at touch
            start), so inner ScrollView pans can still claim the move
            responder and scroll natively. The previous
            `onStartShouldSetResponder={() => true}` on the card grabbed
            every touch start, which on iOS prevented nested ScrollViews
            inside from ever taking over on pan. */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.card,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              // Definite height (not maxHeight) — RN's flex layout doesn't
              // reliably propagate bounds to nested ScrollViews when the
              // parent only has maxHeight. With a definite height, the
              // ScrollView's `flex: 1` resolves to a real pixel size and
              // native scroll engages cleanly when content overflows.
              height: screenH * 0.7,
            },
          ]}
          accessibilityViewIsModal
        >
          {/* Brand chrome — gold rule */}
          <View style={[styles.topRule, { backgroundColor: c.gold }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <ThemedText
                type="varsitySmall"
                style={[styles.weekLabel, { color: c.gold }]}
                numberOfLines={1}
              >
                {weekLabel.toUpperCase()}
              </ThemedText>
              <ThemedText
                type="display"
                style={[styles.title, { color: c.text }]}
                accessibilityRole="header"
              >
                Weekly Summary
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={ms(20)} color={c.secondaryText} />
            </TouchableOpacity>
          </View>

          {/* Vertical scroll body. flexShrink: 1 lets it shrink within the
              card's maxHeight when content overflows; native scroll engages
              once the shrunken bounds are smaller than the content. */}
          <ScrollView
            bounces={false}
            style={styles.body}
            nestedScrollEnabled
          >
            <TeamSection
              team={homeTeam}
              columns={columns}
              c={c}
              liveMap={liveMap}
              scoring={scoring}
            />
            {awayTeam && (
              <TeamSection
                team={awayTeam}
                columns={columns}
                c={c}
                liveMap={liveMap}
                scoring={scoring}
              />
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Team Section ──────────────────────────────────────────────────────────

interface TeamSectionProps {
  team: TeamData;
  columns: { label: string; key: string }[];
  c: ReturnType<typeof useColors>;
  liveMap?: Map<string, LivePlayerStats>;
  scoring: ScoringWeight[];
}

function TeamSection({ team, columns, c, liveMap, scoring }: TeamSectionProps) {
  // Merge live games into players' weekly totals before sorting/rendering.
  // `liveMap` here is the hero live map — built upstream to hold ONLY games
  // that aren't in player_games yet (today's games, plus yesterday's still-
  // live ones; yesterday's finals are already counted in `weekGameStats`).
  // So every entry can be merged unconditionally — no double-count risk —
  // and the summary total ends up identical to the hero's week score.
  const playersWithLive = team.players.map((p) => {
    if (!liveMap) return p;
    const live = liveMap.get(p.player_id);
    if (!live || live.game_status < 2) return p;
    if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === ROSTER_SLOT.DROPPED) return p;

    const liveGameLog = liveToGameLog(live);
    const liveFpts = calculateGameFantasyPoints(liveGameLog as any, scoring);

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

  // Only show players with actual production (drops 0-minute games / DNPs).
  const starters = playersWithLive
    .filter((p) => {
      if (!p.weekGameStats) return false;
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

  // Width of the box-score grid. The inner View pins to this width so the
  // horizontal ScrollView always allows panning past the visible track when
  // there are more columns than fit.
  const tableWidth = NAME_W + FPTS_W + columns.length * STAT_W + ROW_PAD * 2;
  const tricode = team.tricode ?? team.teamName.slice(0, 4).toUpperCase();

  return (
    <View style={styles.teamSection}>
      {/* Scoreboard band — gold left rule + tricode + total fpts on the right.
          Reads as a stadium header strip per team. */}
      <View style={[styles.banner, { backgroundColor: c.cardAlt }]}>
        <View style={[styles.bannerRule, { backgroundColor: c.gold }]} />
        <View style={styles.bannerText}>
          <ThemedText
            type="varsity"
            style={[styles.bannerTri, { color: c.text }]}
            numberOfLines={1}
          >
            {tricode}
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.bannerName, { color: c.secondaryText }]}
            numberOfLines={1}
          >
            {team.teamName}
          </ThemedText>
        </View>
        <Text
          style={[styles.bannerScore, { color: c.gold }]}
          accessibilityLabel={`${team.teamName} weekly total: ${formatScore(round1(totalFpts))} fantasy points`}
        >
          {formatScore(round1(totalFpts))}
        </Text>
      </View>

      {starters.length === 0 ? (
        <View style={styles.emptyRow}>
          <Text style={[styles.emptyText, { color: c.secondaryText }]}>
            No games played yet
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          bounces={false}
          nestedScrollEnabled
          style={styles.gridScroll}
        >
          <View style={{ width: tableWidth }}>
            {/* Column headers */}
            <View
              style={[
                styles.row,
                styles.headerRow,
                { borderBottomColor: c.border, backgroundColor: c.cardAlt },
              ]}
            >
              <Text style={[styles.nameCol, styles.colHeader, { color: c.secondaryText }]}>
                PLAYER
              </Text>
              <Text
                style={[styles.fptsCol, styles.colHeader, { color: c.gold }]}
              >
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
            {starters.map((p, i) => (
              <View
                key={p.player_id}
                style={[
                  styles.row,
                  { borderBottomColor: c.border },
                  i % 2 === 1 && { backgroundColor: c.cardAlt },
                ]}
                accessibilityLabel={`${p.name}${p.roster_slot === ROSTER_SLOT.DROPPED ? ', dropped' : ''}: ${formatScore(p.weekPoints)} fantasy points, ${columns.map((col) => `${col.label} ${p.weekGameStats?.[col.key] ?? 0}`).join(', ')}`}
              >
                <View style={[styles.nameCol, styles.nameCell]}>
                  <Text style={[styles.nameText, { color: c.text }]} numberOfLines={1}>
                    {abbreviateFirstName(p.name)}
                  </Text>
                  {/* Dropped players keep their pre-drop points in the
                      summary — the gold tag flags that they're no longer
                      on the roster, replacing the pro-team tricode. */}
                  {p.roster_slot === ROSTER_SLOT.DROPPED ? (
                    <Text style={[styles.proTeam, { color: c.gold }]}>
                      DROPPED
                    </Text>
                  ) : p.nbaTricode ? (
                    <Text style={[styles.proTeam, { color: c.secondaryText }]}>
                      {p.nbaTricode}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.fptsCol, styles.fptsValue, { color: c.gold }]}>
                  {formatScore(p.weekPoints)}
                </Text>
                {columns.map((col) => (
                  <Text key={col.key} style={[styles.statCol, styles.statValue, { color: c.text }]}>
                    {formatStatValue(p.weekGameStats?.[col.key] ?? 0)}
                  </Text>
                ))}
              </View>
            ))}

            {/* Total row — gold top rule echoes the team banner */}
            <View
              style={[styles.row, styles.totalRow, { borderTopColor: c.gold }]}
              accessibilityLabel={`Team total: ${formatScore(round1(totalFpts))} fantasy points`}
            >
              <Text style={[styles.nameCol, styles.totalLabel, { color: c.gold }]}>
                TOTAL
              </Text>
              <Text style={[styles.fptsCol, styles.fptsValue, styles.totalText, { color: c.gold }]}>
                {formatScore(round1(totalFpts))}
              </Text>
              {columns.map((col) => (
                <Text
                  key={col.key}
                  style={[styles.statCol, styles.statValue, styles.totalText, { color: c.text }]}
                >
                  {formatStatValue(totals[col.key] ?? 0)}
                </Text>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatStatValue(val: number): string {
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(12),
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    width: '100%',
    maxWidth: s(420),
    overflow: 'hidden',
    ...cardShadow,
  },
  topRule: {
    height: 2,
    width: s(40),
    marginLeft: s(16),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: s(16),
    paddingTop: s(8),
    paddingBottom: s(10),
    gap: s(10),
  },
  weekLabel: {
    fontSize: ms(9),
    letterSpacing: 1.2,
    marginBottom: s(1),
  },
  title: {
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
  closeBtn: {
    padding: s(2),
  },
  // The card has a definite height; flex: 1 here forces the ScrollView
  // to fill the remaining space after the header (instead of shrinking
  // to its content size). With a real pixel bound on the ScrollView and
  // content larger than that, native scroll engages.
  body: {
    flex: 1,
  },

  // ── Per-team scoreboard banner ─────────────────────────────────────────
  teamSection: {
    paddingHorizontal: s(12),
    paddingBottom: s(10),
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    gap: s(10),
    borderRadius: 8,
    marginBottom: s(6),
  },
  bannerRule: {
    width: s(2),
    height: ms(22),
    borderRadius: 1,
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
  },
  bannerTri: {
    fontSize: ms(13),
    letterSpacing: 0.9,
  },
  bannerName: {
    fontSize: ms(9),
    letterSpacing: 0.5,
  },
  bannerScore: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(18),
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },

  // ── Box-score grid (horizontal scroll) ─────────────────────────────────
  gridScroll: {
    // No explicit height; the inner `<View style={{ width }}>` widens past
    // the screen so the horizontal ScrollView pans through the columns.
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: ROW_PAD,
    paddingVertical: s(7),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    paddingVertical: s(5),
  },
  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1.5,
    paddingTop: s(8),
    paddingBottom: s(10),
  },
  totalText: {
    fontWeight: '700',
  },
  totalLabel: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
  colHeader: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },

  nameCol: {
    width: NAME_W,
    paddingRight: s(6),
  },
  nameCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    flexShrink: 1,
  },
  nameText: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: ms(12),
    fontWeight: '600',
  },
  proTeam: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(8.5),
    letterSpacing: 0.7,
  },

  fptsCol: {
    width: FPTS_W,
    textAlign: 'right',
    paddingRight: s(6),
  },
  fptsValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '700',
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },
  statCol: {
    width: STAT_W,
    textAlign: 'center',
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },

  emptyRow: {
    paddingVertical: s(14),
    paddingHorizontal: s(8),
  },
  emptyText: {
    fontSize: ms(12),
    fontStyle: 'italic',
  },
});
