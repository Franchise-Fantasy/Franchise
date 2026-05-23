import { Image } from "expo-image";
import { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { round1, type RosterPlayer } from "@/components/matchup/PlayerCell";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { rosterStyles } from "@/components/roster/rosterStyles";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ThemedText } from "@/components/ui/ThemedText";
import { type Sport } from "@/constants/LeagueDefaults";
import { useColors } from "@/hooks/useColors";
import { type ScoringWeight } from "@/types/player";
import { abbreviateFirstName } from "@/utils/formatting";
import { liveToGameLog, type LivePlayerStats } from "@/utils/nba/nbaLive";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import { ms, s } from "@/utils/scale";
import {
  calculateGameFantasyPoints,
  formatScore,
  STAT_TO_GAME,
} from "@/utils/scoring/fantasyPoints";

// Canonical stat ordering for the breakdown grid.
const STAT_ORDER = [
  "PTS", "REB", "AST", "BLK", "STL", "TO",
  "3PM", "3PA", "FGM", "FGA", "FTM", "FTA", "PF", "DD", "TD",
];

const NAME_W = s(96);
const FPTS_W = s(54);
const STAT_W = s(40);
const HEADER_H = ms(18);
const ROW_H = s(58);

function formatStatValue(val: number): string {
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

/**
 * Merge in-progress games into each player's weekly totals. `liveMap`
 * must hold ONLY games not yet in player_games (today's games, plus
 * yesterday's still-live ones) — yesterday's finals are already counted
 * in `weekGameStats`, so passing them here would double-count. Bench/IR/
 * dropped slots never merge. Affects the displayed FPTS + box score only;
 * "games played" and the vs-expected indicator count completed games
 * separately (see the sheet's completed pass).
 */
export function mergeLiveWeekStats(
  players: RosterPlayer[],
  liveMap: Map<string, LivePlayerStats> | undefined,
  scoring: ScoringWeight[],
): RosterPlayer[] {
  if (!liveMap) return players;
  return players.map((p) => {
    const live = liveMap.get(p.player_id);
    if (!live || live.game_status < 2) return p;
    if (
      p.roster_slot === "BE" ||
      p.roster_slot === "IR" ||
      p.roster_slot === ROSTER_SLOT.DROPPED
    )
      return p;

    const liveGameLog = liveToGameLog(live);
    const liveFpts = calculateGameFantasyPoints(liveGameLog as any, scoring);

    const merged: Record<string, number> = { ...(p.weekGameStats ?? {}) };
    for (const [key, val] of Object.entries(liveGameLog)) {
      if (val == null) continue;
      const numVal = typeof val === "boolean" ? (val ? 1 : 0) : Number(val);
      merged[key] = (merged[key] ?? 0) + numVal;
    }

    return {
      ...p,
      weekPoints: round1(p.weekPoints + liveFpts),
      weekGameStats: merged,
    };
  });
}

export interface TeamBreakdown {
  teamName: string;
  tricode: string | null;
  /** Week roster (current + dropped), each carrying weekPoints/weekGames. */
  players: RosterPlayer[];
}

interface WeekSummarySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Sheet title, e.g. "Week 3" or "Playoffs · Week 3". */
  weekLabel: string;
  /** One team (roster page) or two (matchup page → adds a team toggle). */
  teams: TeamBreakdown[];
  scoring: ScoringWeight[];
  isCategories: boolean;
  sport: Sport;
  /** Live-merge map (today + still-live only). Omit for past weeks. */
  liveMap?: Map<string, LivePlayerStats>;
  /** True while the data is in flight (distinguishes loading from empty). */
  loading?: boolean;
}

/**
 * Shared weekly performance breakdown. A frozen left column (portrait +
 * name + week FPTS, with a vs-expected ▲/▼) and a horizontally-scrollable
 * box score that pans all rows together. Given two teams it shows a team
 * toggle. Used by both the roster page (one team) and the matchup page
 * (both sides).
 */
export function WeekSummarySheet({
  visible,
  onClose,
  weekLabel,
  teams,
  scoring,
  isCategories,
  sport,
  liveMap,
  loading,
}: WeekSummarySheetProps) {
  const c = useColors();
  const [teamIdx, setTeamIdx] = useState(0);
  const team = teams[teamIdx] ?? teams[0];
  const players = useMemo(
    () => teams[teamIdx]?.players ?? teams[0]?.players ?? [],
    [teams, teamIdx],
  );

  const ranked = useMemo(() => {
    const merged = mergeLiveWeekStats(players, liveMap, scoring);
    return merged
      .filter(
        (p) =>
          p.weekGameStats &&
          Object.values(p.weekGameStats).some((v) => v !== 0),
      )
      .sort((a, b) =>
        isCategories
          ? (b.weekGameStats?.pts ?? 0) - (a.weekGameStats?.pts ?? 0)
          : b.weekPoints - a.weekPoints,
      );
  }, [players, liveMap, scoring, isCategories]);

  const total = useMemo(
    () => round1(ranked.reduce((sum, p) => sum + p.weekPoints, 0)),
    [ranked],
  );

  // Games played + points from COMPLETED games only. In-progress games show
  // their live points in the FPTS number but are excluded here so a half-
  // finished game neither inflates the over/under nor counts as a game.
  const completedById = useMemo(() => {
    const m = new Map<string, { games: number; points: number }>();
    for (const raw of players) {
      let games = raw.weekGames;
      let points = raw.weekPoints;
      const live = liveMap?.get(raw.player_id);
      const benched =
        raw.roster_slot === "BE" ||
        raw.roster_slot === "IR" ||
        raw.roster_slot === ROSTER_SLOT.DROPPED;
      // Live stats carry no minutes, so use production as the played-proxy
      // for today's *final* games — drops today's DNPs.
      const livePlayed =
        !!live &&
        live.game_status === 3 &&
        !benched &&
        (live.pts > 0 ||
          live.reb > 0 ||
          live.ast > 0 ||
          live.stl > 0 ||
          live.blk > 0 ||
          live.fga > 0 ||
          live.fta > 0 ||
          live.tov > 0 ||
          live.pf > 0);
      if (livePlayed) {
        games += 1;
        points = round1(
          points + calculateGameFantasyPoints(liveToGameLog(live!) as any, scoring),
        );
      }
      m.set(raw.player_id, { games, points });
    }
    return m;
  }, [players, liveMap, scoring]);

  const totalPct = useMemo(() => {
    let expected = 0;
    let points = 0;
    for (const p of ranked) {
      const comp = completedById.get(p.player_id);
      if (!comp) continue;
      expected += (p.seasonAvgFpts ?? 0) * comp.games;
      points += comp.points;
    }
    return expected > 0 ? Math.round((points / expected - 1) * 100) : null;
  }, [ranked, completedById]);

  const statColumns = useMemo(
    () =>
      scoring
        .map((w) => ({
          label: w.stat_name,
          key: STAT_TO_GAME[w.stat_name] as string | undefined,
        }))
        .filter((col): col is { label: string; key: string } => col.key != null)
        .sort((a, b) => {
          const ai = STAT_ORDER.indexOf(a.label);
          const bi = STAT_ORDER.indexOf(b.label);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        }),
    [scoring],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={weekLabel}
      subtitle={teams.length === 1 ? team?.teamName?.toUpperCase() : undefined}
      headerAction={
        isCategories ? undefined : (
          <View style={styles.totalChip}>
            <ThemedText
              type="varsitySmall"
              style={[styles.totalChipLabel, { color: c.secondaryText }]}
            >
              WEEK TOTAL
            </ThemedText>
            <ThemedText
              style={[styles.totalChipValue, { color: c.gold }]}
              accessibilityLabel={`Week total ${formatScore(total)} fantasy points`}
            >
              {formatScore(total)}
            </ThemedText>
            {totalPct != null && (
              <ThemedText
                style={[
                  styles.delta,
                  { color: totalPct >= 0 ? c.success : c.danger },
                ]}
              >
                {totalPct >= 0 ? "▲" : "▼"} {Math.abs(totalPct)}%
              </ThemedText>
            )}
          </View>
        )
      }
      bodyStyle={styles.body}
    >
      {/* Team toggle — only when two teams are supplied (matchup page). */}
      {teams.length > 1 && (
        <View style={[styles.toggle, { borderColor: c.border }]}>
          {teams.map((t, i) => {
            const active = i === teamIdx;
            return (
              <TouchableOpacity
                key={t.tricode ?? t.teamName}
                onPress={() => setTeamIdx(i)}
                style={[
                  styles.toggleBtn,
                  active && {
                    backgroundColor: c.activeCard,
                    borderColor: c.activeBorder,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.teamName}
              >
                <ThemedText
                  type="varsity"
                  style={[
                    styles.toggleText,
                    { color: active ? c.activeText : c.secondaryText },
                  ]}
                  numberOfLines={1}
                >
                  {t.tricode ?? t.teamName}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {ranked.length === 0 ? (
        <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
          {loading ? "Loading…" : "No games played yet this week."}
        </ThemedText>
      ) : (
        <>
          {!isCategories && (
            <ThemedText
              type="varsitySmall"
              style={[styles.legend, { color: c.secondaryText }]}
            >
              ▲▼ = WEEK VS. EXPECTED (SEASON AVG)
            </ThemedText>
          )}
          <View style={styles.table}>
            {/* Frozen column — portrait, name, week FPTS */}
            <View>
              <View style={[styles.headerRow, { height: HEADER_H }]}>
                <View style={styles.frozenHeadSpacer} />
                {!isCategories && (
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.colHead, { width: FPTS_W, color: c.gold }]}
                  >
                    FPTS
                  </ThemedText>
                )}
              </View>
              {ranked.map((p) => {
                const logoUrl = getTeamLogoUrl(p.pro_team, sport);
                const comp = completedById.get(p.player_id) ?? {
                  games: p.weekGames,
                  points: p.weekPoints,
                };
                const expected = (p.seasonAvgFpts ?? 0) * comp.games;
                const pct =
                  expected > 0
                    ? Math.round((comp.points / expected - 1) * 100)
                    : null;
                return (
                  <View
                    key={p.player_id}
                    style={[styles.frozenRow, { borderBottomColor: c.border }]}
                    accessibilityLabel={`${p.name}${
                      isCategories ? "" : `, ${formatScore(p.weekPoints)} points`
                    }${
                      pct != null
                        ? `, ${pct >= 0 ? `${pct}% over` : `${-pct}% under`} expected`
                        : ""
                    }, ${statColumns
                      .filter((col) => (p.weekGameStats?.[col.key] ?? 0) !== 0)
                      .map((col) => `${p.weekGameStats![col.key]} ${col.label}`)
                      .join(", ")}`}
                  >
                    <View
                      style={rosterStyles.rosterPortraitWrap}
                      accessible={false}
                    >
                      <View
                        style={[
                          rosterStyles.rosterHeadshotCircle,
                          {
                            borderColor: c.heritageGold,
                            backgroundColor: c.cardAlt,
                          },
                        ]}
                      >
                        <PlayerHeadshotImage
                          externalIdNba={p.external_id_nba}
                          sport={sport}
                          style={rosterStyles.rosterHeadshotImg}
                          accessible={false}
                        />
                      </View>
                      <View style={rosterStyles.rosterTeamPill}>
                        {logoUrl && (
                          <Image
                            source={{ uri: logoUrl }}
                            style={rosterStyles.rosterTeamPillLogo}
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            recyclingKey={logoUrl}
                          />
                        )}
                        <Text
                          style={[
                            rosterStyles.rosterTeamPillText,
                            { color: c.statusText },
                          ]}
                        >
                          {p.pro_team}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.nameCol}>
                      <ThemedText
                        style={[styles.name, { color: c.text }]}
                        numberOfLines={1}
                      >
                        {abbreviateFirstName(p.name)}
                      </ThemedText>
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.gp, { color: c.secondaryText }]}
                      >
                        {comp.games} {comp.games === 1 ? "GAME" : "GAMES"}
                      </ThemedText>
                    </View>
                    {!isCategories && (
                      <View style={styles.fptsCol}>
                        <ThemedText style={[styles.fpts, { color: c.gold }]}>
                          {formatScore(p.weekPoints)}
                        </ThemedText>
                        {pct != null && (
                          <ThemedText
                            style={[
                              styles.delta,
                              { color: pct >= 0 ? c.success : c.danger },
                            ]}
                          >
                            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
                          </ThemedText>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Scrollable box score — all rows pan together */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              bounces={false}
              style={styles.statsScroll}
            >
              <View>
                <View style={[styles.headerRow, { height: HEADER_H }]}>
                  {statColumns.map((col) => (
                    <ThemedText
                      key={col.key}
                      type="varsitySmall"
                      style={[
                        styles.colHead,
                        { width: STAT_W, color: c.secondaryText },
                      ]}
                    >
                      {col.label}
                    </ThemedText>
                  ))}
                </View>
                {ranked.map((p) => (
                  <View
                    key={p.player_id}
                    style={[styles.statRow, { borderBottomColor: c.border }]}
                    accessible={false}
                  >
                    {statColumns.map((col) => {
                      const v = p.weekGameStats?.[col.key] ?? 0;
                      return (
                        <Text
                          key={col.key}
                          style={[
                            styles.statVal,
                            { width: STAT_W },
                            { color: v ? c.text : c.secondaryText },
                          ]}
                        >
                          {v ? formatStatValue(v) : "—"}
                        </Text>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: s(12),
  },
  totalChip: {
    alignItems: "flex-end",
  },
  totalChipLabel: {
    fontSize: ms(8),
    letterSpacing: 1.2,
  },
  totalChipValue: {
    fontFamily: "SpaceMono",
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums"],
  },
  toggle: {
    flexDirection: "row",
    gap: s(6),
    marginBottom: s(10),
  },
  toggleBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toggleText: {
    fontSize: ms(12),
    letterSpacing: 0.8,
  },
  empty: {
    fontSize: ms(13),
    fontStyle: "italic",
    paddingVertical: s(12),
  },
  table: {
    flexDirection: "row",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: s(4),
  },
  frozenHeadSpacer: {
    // portrait (48) + gap + name + gap — aligns the FPTS label over its column.
    width: s(48) + NAME_W + s(16),
  },
  colHead: {
    fontSize: ms(9),
    letterSpacing: 0.8,
    textAlign: "center",
  },
  frozenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameCol: {
    width: NAME_W,
  },
  name: {
    fontSize: ms(15),
    fontWeight: "600",
  },
  gp: {
    fontSize: ms(9),
    letterSpacing: 0.6,
    marginTop: s(1),
  },
  fptsCol: {
    width: FPTS_W,
    alignItems: "center",
    justifyContent: "center",
  },
  fpts: {
    fontFamily: "SpaceMono",
    fontSize: ms(15),
    lineHeight: ms(16),
    fontWeight: "700",
    letterSpacing: 0.2,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  delta: {
    fontSize: ms(10),
    lineHeight: ms(12),
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  legend: {
    fontSize: ms(9),
    letterSpacing: 0.8,
    marginBottom: s(8),
  },
  statsScroll: {
    flex: 1,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statVal: {
    fontFamily: "SpaceMono",
    fontSize: ms(13),
    letterSpacing: 0.2,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
