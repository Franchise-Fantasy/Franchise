import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

import { ComingSoonTeaser } from "@/components/analytics/ComingSoonTeaser";
import { Badge } from "@/components/ui/Badge";
import { InfoModal } from "@/components/ui/InfoModal";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts, cardShadow } from "@/constants/Colors";
import { getPreviousSeason, type Sport } from "@/constants/LeagueDefaults";
import { useColors } from "@/hooks/useColors";
import { useRosterGameLogs } from "@/hooks/useRosterGameLogs";
import { PlayerSeasonStats, ScoringWeight } from "@/types/player";
import { ordinalSuffix } from "@/utils/formatting";
import { isActiveRosterSlot } from "@/utils/roster/rosterSlots";
import { buildLeagueStrengthComparison } from "@/utils/roster/rosterStrength";
import { ms, s } from "@/utils/scale";
import {
  ANALYTICS_MIN_CURRENT_SEASON_GAMES,
  calculateAvgFantasyPoints,
  effectiveFantasyPoints,
} from "@/utils/scoring/fantasyPoints";
import { buildRosterTrendBoard, RosterTrendEntry } from "@/utils/scoring/rosterTrends";
import { TREND_CONFIG } from "@/utils/scoring/trendDisplay";

const RECENT_WINDOW = 10;

type RosterStatPlayer = PlayerSeasonStats & { roster_slot?: string | null };

interface PointsStrengthAnalyticsProps {
  players: RosterStatPlayer[];
  allPlayers: (PlayerSeasonStats & { team_id: string; roster_slot?: string | null })[];
  weights: ScoringWeight[] | undefined;
  prevSeasonFptsMap?: Map<string, number>;
  teamId: string;
  sport: Sport;
}

/** "2024-25" → "'24-25", "2024" → "'24" — compact prior-season chip label. */
function shortSeasonLabel(season: string): string {
  return `'${season.slice(2)}`;
}

interface ScoringEntry {
  playerId: string;
  name: string;
  avgFpts: number; // effective FPTS/G — this season after 5 games, else last season
  fromLastSeason: boolean; // true when avgFpts is last season's number (too few games this year)
  rosterSlot: string | null; // for the IR / TAXI tag
}

/**
 * Non-age analytics for single-year (keeper/redraft) leagues. Shows a
 * roster-strength overview (matching the home preview) plus a per-player
 * scoring list ranked by season FPTS/G, with recent hot/cold streaks flagged
 * inline on the movers (sell-high on risers, hold on slumpers). The teaser
 * marks where the projection-based "performance vs expected" view will land.
 * No age framing — that only matters in dynasty leagues.
 */
export function PointsStrengthAnalytics({
  players,
  allPlayers,
  weights,
  prevSeasonFptsMap,
  teamId,
  sport,
}: PointsStrengthAnalyticsProps) {
  const c = useColors();
  const prevSeasonLabel = shortSeasonLabel(getPreviousSeason(sport));
  const [infoVisible, setInfoVisible] = useState(false);

  const playerIds = useMemo(() => players.map((p) => p.player_id), [players]);
  const { data: gameLogsByPlayer } = useRosterGameLogs(playerIds);

  // League standing by total roster FPTS/G — the overview card.
  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueStrengthComparison(
      allPlayers as any,
      weights,
      teamId,
      prevSeasonFptsMap,
      ANALYTICS_MIN_CURRENT_SEASON_GAMES,
    );
  }, [allPlayers, weights, teamId, prevSeasonFptsMap]);

  // Per-player scoring list, highest first. Uses the same effective FPTS/G as
  // the strength card (this season once a player hits the games threshold,
  // else last season) so the list and the rank/vs-league numbers agree.
  const scoring = useMemo<ScoringEntry[]>(() => {
    if (!players.length || !weights?.length) return [];
    return players
      .map((p) => {
        const fallback = prevSeasonFptsMap?.get(p.player_id) ?? 0;
        // Mirrors the branch effectiveFantasyPoints takes: last season's number
        // is used when this season is under the games threshold and a fallback exists.
        const fromLastSeason =
          (p.games_played ?? 0) < ANALYTICS_MIN_CURRENT_SEASON_GAMES && fallback > 0;
        return {
          playerId: p.player_id,
          name: p.name,
          avgFpts: effectiveFantasyPoints(p, weights, prevSeasonFptsMap, ANALYTICS_MIN_CURRENT_SEASON_GAMES),
          fromLastSeason,
          rosterSlot: p.roster_slot ?? null,
        };
      })
      .filter((e) => e.avgFpts > 0)
      .sort((a, b) => b.avgFpts - a.avgFpts);
  }, [players, weights, prevSeasonFptsMap]);

  // Recent hot/cold streaks, keyed by player_id for inline annotation.
  // Only movers (hot/cold) land here — neutral players show no badge.
  // Reuses the same insight math as the player-detail modal.
  const trendById = useMemo(() => {
    const m = new Map<string, RosterTrendEntry>();
    if (!players.length || !weights?.length || !gameLogsByPlayer) return m;
    const seasonAvgById = new Map<string, number>();
    for (const p of players) {
      seasonAvgById.set(p.player_id, calculateAvgFantasyPoints(p, weights));
    }
    const board = buildRosterTrendBoard(
      players.map((p) => ({ player_id: p.player_id, name: p.name })),
      gameLogsByPlayer,
      weights,
      (id) => seasonAvgById.get(id) ?? 0,
      RECENT_WINDOW,
    );
    for (const e of [...board.heatingUp, ...board.coolingOff]) m.set(e.playerId, e);
    return m;
  }, [players, weights, gameLogsByPlayer]);

  const vsAvg = comparison ? comparison.myTotalFpts - comparison.leagueAvgFpts : 0;

  // Only surface the "IR/taxi excluded" caption when the league actually has
  // such players — redraft leagues without those slots shouldn't see it.
  const hasInactive = useMemo(
    () => allPlayers.some((p) => !isActiveRosterSlot(p.roster_slot)),
    [allPlayers],
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Roster-strength overview ── secondary context that matches the
          home preview card (rank + vs-league FPTS/G), so tapping in confirms
          and expands what the preview teased. Not the focus — the trend board
          below is the actionable hero. */}
      {comparison && (
        <View
          style={[
            styles.strengthCard,
            {
              backgroundColor: c.heritageGoldMuted,
              borderColor: c.border,
              ...cardShadow,
              ...(Platform.OS === "android" && { elevation: 0 }),
            },
          ]}
        >
          <View style={[styles.topNotch, { backgroundColor: c.primary }]} />
          <ThemedText type="varsitySmall" style={[styles.eyebrow, { color: c.primary }]}>
            ROSTER STRENGTH
          </ThemedText>
          <View style={styles.columnsRow}>
            <View
              style={styles.column}
              accessibilityLabel={`Ranked ${comparison.myRank}${ordinalSuffix(comparison.myRank)} of ${comparison.totalTeams} teams by roster strength`}
            >
              <ThemedText type="varsitySmall" style={[styles.columnLabel, { color: c.secondaryText }]}>
                LEAGUE RANK
              </ThemedText>
              <ThemedText type="display" style={[styles.columnBig, { color: c.text }]} numberOfLines={1}>
                {`${comparison.myRank}${ordinalSuffix(comparison.myRank)}`}
              </ThemedText>
              <ThemedText type="varsitySmall" style={[styles.columnSub, { color: c.secondaryText }]}>
                {`OF ${comparison.totalTeams}`}
              </ThemedText>
            </View>

            <View style={[styles.columnDivider, { backgroundColor: c.border }]} />

            <View
              style={styles.column}
              accessibilityLabel={`${vsAvg >= 0 ? "plus" : "minus"} ${Math.abs(vsAvg).toFixed(1)} fantasy points per game versus the league average`}
            >
              <ThemedText type="varsitySmall" style={[styles.columnLabel, { color: c.secondaryText }]}>
                VS LEAGUE
              </ThemedText>
              <ThemedText type="display" style={[styles.columnBig, { color: c.text }]} numberOfLines={1}>
                {`${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(1)}`}
              </ThemedText>
              <ThemedText type="varsitySmall" style={[styles.columnSub, { color: c.secondaryText }]}>
                FPTS/G VS AVG
              </ThemedText>
            </View>
          </View>

          {hasInactive && (
            <ThemedText type="varsitySmall" style={[styles.strengthNote, { color: c.secondaryText }]}>
              ACTIVE ROSTER ONLY · IR &amp; TAXI NOT COUNTED
            </ThemedText>
          )}
        </View>
      )}

      {/* ── Per-player scoring list with hot/cold flagged inline ── */}
      {scoring.length === 0 ? (
        <TrendEmpty
          title="No scoring data yet."
          sub="ROSTER HAS NO STATS TO SHOW"
        />
      ) : (
        <View
          style={[styles.listCard, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}
        >
          <View style={styles.detailEyebrowRow}>
            <View style={[styles.detailRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.detailEyebrow, { color: c.secondaryText, flex: 1 }]}
            >
              ROSTER SCORING
            </ThemedText>
            <TouchableOpacity
              onPress={() => setInfoVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="How hot and cold streaks are calculated"
            >
              <Ionicons name="information-circle-outline" size={ms(18)} color={c.secondaryText} />
            </TouchableOpacity>
          </View>
          <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
            FPTS/G — recent hot/cold streaks flagged
          </ThemedText>
          {scoring.map((entry) => (
            <ScoringRow
              key={entry.playerId}
              entry={entry}
              trend={trendById.get(entry.playerId)}
              prevSeasonLabel={prevSeasonLabel}
            />
          ))}
          {scoring.some((e) => e.fromLastSeason) && (
            <ThemedText style={[styles.legend, { color: c.secondaryText }]}>
              {`${prevSeasonLabel} = last season's average, shown for players with fewer than ${ANALYTICS_MIN_CURRENT_SEASON_GAMES} GP this season.`}
            </ThemedText>
          )}
        </View>
      )}

      <ComingSoonTeaser />

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="How streaks are calculated"
        message={
          `Recent form is compared to each player's season average — the same "Insights" math from their detail page, so a flag here matches what you see when you tap in.\n\n` +
          `We average their last ${RECENT_WINDOW} games of fantasy points (skipping games they barely played) and compare it to their season average. The gap is scaled by how streaky that player usually is, so steady scorers and boom-or-bust players are judged fairly:\n\n` +
          `• ▲▲ Scorching / ▲ Hot — well above their usual lately\n` +
          `• ▼ Cold / ▼▼ Frigid — well below their usual lately\n` +
          `• Players in their normal range aren't flagged\n\n` +
          `The percentage shown is the raw change in that last-${RECENT_WINDOW} average vs the season average (so a streaky player can read "+30%" yet only rank Hot, not Scorching).\n\n` +
          `${prevSeasonLabel}: players with fewer than ${ANALYTICS_MIN_CURRENT_SEASON_GAMES} games this season show last season's average and aren't flagged for streaks yet.`
        }
      />
    </ScrollView>
  );
}

function TrendEmpty({ title, sub }: { title: string; sub: string }) {
  const c = useColors();
  return (
    <View style={styles.trendEmpty} accessibilityLabel={`${title} ${sub}`}>
      <View style={[styles.trendEmptyRule, { backgroundColor: c.gold }]} />
      <ThemedText type="display" style={[styles.trendEmptyTitle, { color: c.text }]}>
        {title}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.trendEmptySub, { color: c.secondaryText }]}>
        {sub}
      </ThemedText>
    </View>
  );
}

function ScoringRow({
  entry,
  trend,
  prevSeasonLabel,
}: {
  entry: ScoringEntry;
  trend?: RosterTrendEntry;
  prevSeasonLabel: string;
}) {
  const c = useColors();
  const cfg = trend ? TREND_CONFIG[trend.trend] : null;
  const deltaLabel = trend ? `${trend.trendPct > 0 ? "+" : ""}${trend.trendPct.toFixed(0)}%` : null;
  const isIr = entry.rosterSlot === "IR";
  const isTaxi = entry.rosterSlot === "TAXI";
  const slotNote = isIr
    ? ", on injured reserve — not counted in roster strength"
    : isTaxi
      ? ", on taxi squad — not counted in roster strength"
      : "";
  return (
    <View
      style={[styles.scoreRow, { borderTopColor: c.border }, (isIr || isTaxi) && styles.inactiveRow]}
      accessible
      accessibilityLabel={`${entry.name}, ${entry.avgFpts.toFixed(1)} fantasy points per game${slotNote}${
        trend && cfg
          ? `, ${cfg.label}, ${trend.trendPct >= 0 ? "up" : "down"} ${Math.abs(Math.round(trend.trendPct))} percent over last ${RECENT_WINDOW} games`
          : entry.fromLastSeason
            ? `, showing their ${prevSeasonLabel} average — fewer than ${ANALYTICS_MIN_CURRENT_SEASON_GAMES} games this season`
            : ""
      }`}
    >
      <View style={styles.scoreRowLeft}>
        <View style={styles.nameRow}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.playerName, { color: c.text }]}
            numberOfLines={1}
          >
            {entry.name}
          </ThemedText>
          {isIr && <Badge label="IR" variant="danger" size="small" />}
          {isTaxi && <Badge label="TAXI" variant="neutral" size="small" />}
          {entry.fromLastSeason && (
            <Badge label={prevSeasonLabel} variant="warning" size="small" />
          )}
        </View>
        {trend && cfg && (
          <ThemedText style={[styles.trendSub, { color: cfg.color }]} numberOfLines={1}>
            {`${cfg.icon} ${cfg.label} · ${deltaLabel} last ${RECENT_WINDOW}`}
          </ThemedText>
        )}
      </View>
      <ThemedText type="display" style={[styles.scoreValue, { color: c.text }]}>
        {entry.avgFpts.toFixed(1)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: s(32),
  },

  // Roster-strength overview card — mirrors the home preview chrome
  strengthCard: {
    position: "relative",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(18),
    paddingBottom: s(14),
    marginBottom: s(14),
    overflow: "hidden",
  },
  topNotch: {
    position: "absolute",
    top: 0,
    left: s(16),
    height: 3,
    width: s(44),
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(12),
  },
  columnsRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  column: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: s(2),
  },
  columnLabel: {
    fontSize: ms(9.5),
    letterSpacing: 1.2,
    marginBottom: s(4),
  },
  columnBig: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
    marginBottom: s(2),
  },
  columnSub: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
  },
  columnDivider: {
    width: 1,
    marginHorizontal: s(8),
  },
  strengthNote: {
    fontSize: ms(8.5),
    letterSpacing: 0.8,
    marginTop: s(12),
  },

  // Trend group card
  listCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(14),
    paddingTop: s(12),
    paddingBottom: s(10),
    marginBottom: s(14),
  },
  detailEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    marginBottom: s(4),
  },
  detailRule: {
    height: 2,
    width: s(18),
  },
  detailEyebrow: {
    fontSize: ms(9.5),
    letterSpacing: 1.3,
  },
  subtitle: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginBottom: s(12),
  },

  // Scoring row
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: s(12),
    paddingVertical: s(7),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inactiveRow: {
    // IR/TAXI players don't count toward strength — dim them so the active
    // roster reads as the focus.
    opacity: 0.5,
  },
  scoreRowLeft: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  playerName: {
    flexShrink: 1,
    fontSize: ms(13),
  },
  trendSub: {
    fontSize: ms(10.5),
    letterSpacing: 0.3,
    marginTop: s(2),
  },
  legend: {
    fontSize: ms(10.5),
    fontStyle: "italic",
    lineHeight: ms(15),
    marginTop: s(2),
  },
  scoreValue: {
    fontFamily: Fonts.display,
    fontSize: ms(18),
    letterSpacing: -0.3,
  },

  // Compact empty state for the trend section (sits inline between the
  // strength card and the teaser — not the full-screen AnalyticsEmptyState).
  trendEmpty: {
    alignItems: "center",
    paddingVertical: s(28),
    gap: s(8),
  },
  trendEmptyRule: {
    height: 2,
    width: s(40),
    marginBottom: s(4),
  },
  trendEmptyTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(19),
    lineHeight: ms(23),
    letterSpacing: -0.2,
    textAlign: "center",
  },
  trendEmptySub: {
    fontSize: ms(10.5),
    letterSpacing: 1.3,
    textAlign: "center",
  },
});
