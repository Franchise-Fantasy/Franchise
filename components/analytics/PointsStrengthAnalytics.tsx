import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

import { DependencyRiskCard } from "@/components/analytics/DependencyRiskCard";
import { PerformanceVsExpected } from "@/components/analytics/PerformanceVsExpected";
import { RosterStrengthCard } from "@/components/analytics/RosterStrengthCard";
import { TeamLogo } from "@/components/team/TeamLogo";
import { Badge } from "@/components/ui/Badge";
import { InfoModal } from "@/components/ui/InfoModal";
import { ListRow } from "@/components/ui/ListRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts, cardShadow } from "@/constants/Colors";
import { getPreviousSeason, type Sport } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useColors } from "@/hooks/useColors";
import { useRosterGameLogs } from "@/hooks/useRosterGameLogs";
import { PlayerSeasonStats, ScoringWeight } from "@/types/player";
import { ordinalSuffix } from "@/utils/formatting";
import { fetchStandingsTeams } from "@/utils/league/standingsQueries";
import { isActiveRosterSlot } from "@/utils/roster/rosterSlots";
import { buildLeagueStrengthComparison } from "@/utils/roster/rosterStrength";
import { ms, s } from "@/utils/scale";
import {
  ANALYTICS_MIN_CURRENT_SEASON_GAMES,
  calculateAvgFantasyPoints,
  effectiveFantasyPoints,
  GameWindow,
  gameWindowSize,
  windowFantasyPoints,
} from "@/utils/scoring/fantasyPoints";
import { buildRosterTrendBoard, RosterTrendEntry } from "@/utils/scoring/rosterTrends";
import { TREND_CONFIG } from "@/utils/scoring/trendDisplay";

const RECENT_WINDOW = 10;
const WINDOW_OPTIONS: readonly GameWindow[] = ['L5', 'L10', 'L15', 'season'];
const WINDOW_LABELS: Record<GameWindow, string> = {
  L5: 'Last 5',
  L10: 'Last 10',
  L15: 'Last 15',
  season: 'Season',
};

type RosterStatPlayer = PlayerSeasonStats & { roster_slot?: string | null };

interface PointsStrengthAnalyticsProps {
  players: RosterStatPlayer[];
  allPlayers: (PlayerSeasonStats & { team_id: string; roster_slot?: string | null })[];
  weights: ScoringWeight[] | undefined;
  scoringType: string | undefined;
  prevSeasonFptsMap?: Map<string, number>;
  teamId: string;
  leagueId: string;
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
  scoringType,
  prevSeasonFptsMap,
  teamId,
  leagueId,
  sport,
}: PointsStrengthAnalyticsProps) {
  const c = useColors();
  const prevSeasonLabel = shortSeasonLabel(getPreviousSeason(sport));
  const [infoVisible, setInfoVisible] = useState(false);
  const [windowSel, setWindowSel] = useState<GameWindow>('season');

  // Fetch game logs for the WHOLE league (not just my roster) — the
  // comparison + scoring rows both need them when a Lx window is selected.
  // Trend board reuses the same map (it only reads my roster's keys).
  const allPlayerIds = useMemo(
    () => Array.from(new Set(allPlayers.map((p) => p.player_id))),
    [allPlayers],
  );
  const { data: gameLogsByPlayer } = useRosterGameLogs(allPlayerIds);

  // Only offer a window option when at least one league player has that many
  // games played — early-season views show just 'L5' + 'Season', later views
  // unlock L10 and L15. Mirrors the per-player rule in SeasonAverages.
  // 'season' is always available.
  const maxLeagueGames = useMemo(() => {
    let max = 0;
    for (const p of allPlayers) {
      const g = p.games_played ?? 0;
      if (g > max) max = g;
    }
    return max;
  }, [allPlayers]);
  const availableWindows = useMemo<readonly GameWindow[]>(() => {
    return WINDOW_OPTIONS.filter((w) => {
      const n = gameWindowSize(w);
      return n == null || maxLeagueGames >= n;
    });
  }, [maxLeagueGames]);

  // Snap an invalid selection (e.g. saved L15 in a now-empty offseason league)
  // back to a valid window without losing the user's preference when it'd just
  // become available later.
  useEffect(() => {
    if (!availableWindows.includes(windowSel)) {
      setWindowSel('season');
    }
  }, [availableWindows, windowSel]);

  // Team names/logos for the full-league leaderboard. Shares the standings
  // query key, so this is already in cache whenever the user has visited the
  // Standings tab or seen the home StandingsSection — no extra round-trip.
  const { data: teams } = useQuery({
    queryKey: queryKeys.standings(leagueId),
    queryFn: () => fetchStandingsTeams(leagueId),
    enabled: !!leagueId,
  });
  const teamById = useMemo(() => {
    const m = new Map<string, { name: string; logo_key: string | null; tricode: string | null }>();
    for (const t of teams ?? []) m.set(t.id, { name: t.name, logo_key: t.logo_key, tricode: t.tricode });
    return m;
  }, [teams]);

  // League standing by total roster FPTS/G — the overview card.
  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueStrengthComparison(allPlayers as any, weights, teamId, {
      prevSeasonFptsMap,
      minGames: ANALYTICS_MIN_CURRENT_SEASON_GAMES,
      gameWindow: windowSel,
      gameLogsByPlayer,
    });
  }, [allPlayers, weights, teamId, prevSeasonFptsMap, windowSel, gameLogsByPlayer]);

  // Per-player scoring list, highest first. Each row uses the same FPTS/G
  // calc as the comparison card so the list and the rank/vs-league numbers
  // agree: windowed Lx slice when selected (with season fallback for thin
  // game logs), or the season-with-prev-season-fallback path otherwise.
  const winSize = gameWindowSize(windowSel);
  const scoring = useMemo<ScoringEntry[]>(() => {
    if (!players.length || !weights?.length) return [];
    return players
      .map((p) => {
        const fallback = prevSeasonFptsMap?.get(p.player_id) ?? 0;
        const fromLastSeason =
          winSize == null &&
          (p.games_played ?? 0) < ANALYTICS_MIN_CURRENT_SEASON_GAMES &&
          fallback > 0;
        let avgFpts: number;
        if (winSize != null) {
          const windowed = windowFantasyPoints(
            gameLogsByPlayer?.get(p.player_id),
            weights,
            winSize,
          );
          avgFpts =
            windowed ??
            effectiveFantasyPoints(p, weights, prevSeasonFptsMap, ANALYTICS_MIN_CURRENT_SEASON_GAMES);
        } else {
          avgFpts = effectiveFantasyPoints(
            p,
            weights,
            prevSeasonFptsMap,
            ANALYTICS_MIN_CURRENT_SEASON_GAMES,
          );
        }
        return {
          playerId: p.player_id,
          name: p.name,
          avgFpts,
          fromLastSeason,
          rosterSlot: p.roster_slot ?? null,
        };
      })
      .filter((e) => e.avgFpts > 0)
      .sort((a, b) => b.avgFpts - a.avgFpts);
  }, [players, weights, prevSeasonFptsMap, winSize, gameLogsByPlayer]);

  // Recent hot/cold streaks, keyed by player_id for inline annotation. Only
  // movers (hot/cold) land here — neutral players show no badge. The window
  // is tied to the selector so the trend matches the FPTS/G the user is
  // looking at: on an Lx lens, the last N played games drive the trend; on
  // 'Season' we use a sensible default (mirrors PlayerInsightsCard's default
  // so insights stay readable when the user is on the season view).
  const trendWindow = winSize ?? RECENT_WINDOW;
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
      trendWindow,
    );
    for (const e of [...board.heatingUp, ...board.coolingOff]) m.set(e.playerId, e);
    return m;
  }, [players, weights, gameLogsByPlayer, trendWindow]);

  // Bar scale for the full-league leaderboard — the strongest roster fills the
  // track; the league-average marker sits proportionally within it.
  const maxAvgFpts = comparison
    ? Math.max(...comparison.allProfiles.map((p) => p.avgFpts), comparison.leagueAvgFpts, 1)
    : 1;

  // Only surface the "IR/taxi excluded" caption when the league actually has
  // such players — redraft leagues without those slots shouldn't see it.
  const hasInactive = useMemo(
    () => allPlayers.some((p) => !isActiveRosterSlot(p.roster_slot)),
    [allPlayers],
  );

  const selectedWindowLabel = WINDOW_LABELS[windowSel];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Time-window selector ── all comparison + scoring numbers below
          recompute when this changes. Lx is "last N played games per player"
          (DNPs skipped); apples-to-apples across teams with uneven schedules.
          Options shrink early-season — L10 unlocks once any player hits 10
          games, L15 at 15. Matches the per-player lens in SeasonAverages. */}
      {availableWindows.length > 1 && (
        <View
          style={styles.windowRow}
          accessibilityLabel={`Stat window: ${selectedWindowLabel}. Tap to change.`}
        >
          <SegmentedControl
            options={availableWindows.map((w) => WINDOW_LABELS[w])}
            selectedIndex={Math.max(0, availableWindows.indexOf(windowSel))}
            onSelect={(i) => setWindowSel(availableWindows[i])}
          />
        </View>
      )}

      {/* ── Roster-strength overview ── secondary context that matches the
          home preview card (rank + vs-league FPTS/G), so tapping in confirms
          and expands what the preview teased. Not the focus — the trend board
          below is the actionable hero. */}
      {comparison && (
        <RosterStrengthCard
          comparison={comparison}
          windowLabel={selectedWindowLabel}
          hasInactive={hasInactive}
        />
      )}

      {/* ── Full-league leaderboard ── gives the rank + vs-avg numbers above
          their context: where every team actually sits, with the league
          average marked so "above / below" is a glance, not a calculation. */}
      {comparison && comparison.allProfiles.length > 1 && (
        <View
          style={[styles.listCard, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}
        >
          <View style={styles.detailEyebrowRow}>
            <View style={[styles.detailRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.detailEyebrow, { color: c.secondaryText, flex: 1 }]}
            >
              {`FULL LEAGUE · ${selectedWindowLabel.toUpperCase()}`}
            </ThemedText>
          </View>
          <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
            {`Avg FPTS/G per active player · tick marks league avg (${comparison.leagueAvgFpts.toFixed(1)})`}
          </ThemedText>
          {comparison.allProfiles.map((p, idx) => {
            const team = teamById.get(p.teamId);
            const isMe = p.teamId === teamId;
            const rank = idx + 1;
            const name = team?.name ?? "—";
            const fillPct = Math.min((p.avgFpts / maxAvgFpts) * 100, 100);
            const avgPct = Math.min((comparison.leagueAvgFpts / maxAvgFpts) * 100, 100);
            return (
              <ListRow
                key={p.teamId}
                index={idx}
                total={comparison.allProfiles.length}
                isActive={isMe}
                accessibilityLabel={`${rank}${ordinalSuffix(rank)}, ${name}${isMe ? " (your team)" : ""}, ${p.avgFpts.toFixed(1)} fantasy points per game per player`}
                style={styles.lbRow}
              >
                <ThemedText type="mono" style={[styles.lbRank, { color: c.secondaryText }]}>
                  {rank}
                </ThemedText>
                <View style={styles.lbLogo}>
                  <TeamLogo
                    logoKey={team?.logo_key}
                    teamName={name}
                    tricode={team?.tricode ?? undefined}
                    size="small"
                  />
                </View>
                <ThemedText
                  style={[styles.lbName, { color: c.text, fontWeight: isMe ? "700" : "500" }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {name}
                </ThemedText>
                <View style={[styles.lbBarTrack, { backgroundColor: c.border }]}>
                  <View
                    style={[
                      styles.lbBarFill,
                      { width: `${fillPct}%`, backgroundColor: isMe ? c.primary : c.gold },
                    ]}
                  />
                  <View style={[styles.lbAvgMarker, { left: `${avgPct}%`, borderColor: c.secondaryText }]} />
                </View>
                <ThemedText type="mono" style={[styles.lbValue, { color: c.text }]}>
                  {p.avgFpts.toFixed(1)}
                </ThemedText>
              </ListRow>
            );
          })}
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
              {`ROSTER SCORING · ${selectedWindowLabel.toUpperCase()}`}
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
            {`${winSize != null ? `Avg FPTS/G over ${selectedWindowLabel.toLowerCase()} played games` : 'Season FPTS/G'} — hot/cold streaks flagged vs season avg`}
          </ThemedText>
          {scoring.map((entry) => (
            <ScoringRow
              key={entry.playerId}
              entry={entry}
              trend={trendById.get(entry.playerId)}
              trendWindow={trendWindow}
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

      <DependencyRiskCard
        allPlayers={allPlayers as any}
        weights={weights}
        scoringType={scoringType}
        teamId={teamId}
        leagueId={leagueId}
      />

      <PerformanceVsExpected players={players} weights={weights} sport={sport} />

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="How streaks are calculated"
        message={
          `Recent form is compared to each player's season average — the same "Insights" math from their detail page, so a flag here matches what you see when you tap in.\n\n` +
          `We average their last ${trendWindow} games of fantasy points (skipping games they barely played) and compare it to their season average. The gap is scaled by how streaky that player usually is, so steady scorers and boom-or-bust players are judged fairly:\n\n` +
          `• ▲▲ Scorching / ▲ Hot — well above their usual lately\n` +
          `• ▼ Cold / ▼▼ Frigid — well below their usual lately\n` +
          `• Players in their normal range aren't flagged\n\n` +
          `The percentage shown is the raw change in that last-${trendWindow} average vs the season average (so a streaky player can read "+30%" yet only rank Hot, not Scorching).\n\n` +
          `Switching the stat window above also changes the streak window — when you're on "Last 5", streaks come from the last 5 games; "Season" falls back to the default ${RECENT_WINDOW}-game window so insights stay readable.\n\n` +
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
  trendWindow,
  prevSeasonLabel,
}: {
  entry: ScoringEntry;
  trend?: RosterTrendEntry;
  trendWindow: number;
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
          ? `, ${cfg.label}, ${trend.trendPct >= 0 ? "up" : "down"} ${Math.abs(Math.round(trend.trendPct))} percent over last ${trendWindow} games`
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
            {`${cfg.icon} ${cfg.label} · ${deltaLabel} vs season`}
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

  // Time-window pill bar at the top of the screen
  windowRow: {
    marginBottom: s(12),
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

  // Full-league leaderboard rows
  lbRow: {
    paddingVertical: s(8),
    paddingHorizontal: 0,
    gap: s(8),
  },
  lbRank: {
    width: s(18),
    fontSize: ms(12),
    textAlign: "left",
  },
  lbLogo: {
    width: s(28),
    alignItems: "flex-start",
  },
  lbName: {
    width: s(86),
    fontSize: ms(12.5),
  },
  lbBarTrack: {
    flex: 1,
    height: s(10),
    borderRadius: 4,
    overflow: "hidden",
    position: "relative",
  },
  lbBarFill: {
    height: "100%",
    borderRadius: 4,
    opacity: 0.85,
  },
  // Dashed-look league-average tick — a thin vertical rule overlaid on each
  // bar at the league-average position. overflow:hidden on the track clips it
  // to the bar height.
  lbAvgMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: 1,
    borderStyle: "dashed",
  },
  lbValue: {
    width: s(40),
    fontSize: ms(12.5),
    textAlign: "right",
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
