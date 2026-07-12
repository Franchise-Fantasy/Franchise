import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { PlayerSplits } from "@/components/player/PlayerSplits";
import { ThemedText } from "@/components/ui/ThemedText";
import { cardShadow } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import type { HistoricalSeasonStats } from "@/hooks/usePlayerHistoricalStats";
import type { ProjectionRow } from "@/hooks/usePlayerProjections";
import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from "@/types/player";
import { ms, s } from "@/utils/scale";
import { projAvgRowToFpts, seasonAvgRowToFpts } from "@/utils/scoring/fantasyPoints";
import { averageGames } from "@/utils/scoring/windowAverages";

interface SeasonAveragesProps {
  player: PlayerSeasonStats;
  /** League sport — drives which box-score rows render (basketball default). */
  sport?: string | null;
  /** Label for the current season, e.g. "2025-26". */
  currentSeasonLabel: string;
  /** Pro-team games played so far (the GP denominator for the current season). */
  currentGamesDenominator?: number;
  avgFpts: number | null;
  isCategories: boolean;
  historicalStats: HistoricalSeasonStats[] | undefined;
  scoringWeights: ScoringWeight[] | undefined;
  gameLog: PlayerGameLog[] | undefined;
  /** Season-long projection for this player (projected per-game line), shown as
   *  a "PROJ" lens alongside the actual windows. Null when none exists. */
  projection?: ProjectionRow | null;
  /** Whether the current season has tipped off. Before it has, the current
   *  season has no games yet, so the "current season" lens shows the projected
   *  line in place of an empty box-score (and the separate PROJ chip is dropped
   *  to avoid duplication). */
  seasonStarted: boolean;
}

/** Source stat shape shared by season rows and windowed averages. */
type AvgRow = {
  games_played: number;
  avg_pts: number; avg_reb: number; avg_ast: number; avg_stl: number;
  avg_blk: number; avg_tov: number; avg_min: number;
  avg_fgm: number; avg_fga: number; avg_3pm: number; avg_3pa: number;
  avg_ftm: number; avg_fta: number;
};

type Lens = {
  key: string;
  /** Short chip label, e.g. "L10" or "2025-26". */
  chip: string;
  gpText: string;
  fpts: number | null;
  rows: [[string, string], [string, string]][];
  /** Games backing this lens (for the splits strip); empty for past seasons. */
  games: PlayerGameLog[];
  /** True when this lens shows a projected (not actual) line — drives the
   *  "PROJECTED · SEASON" meta label and suppresses the recent-window trend. */
  projected?: boolean;
};

const RECENT_WINDOWS = [5, 10, 15, 25] as const;

const f1 = (n: unknown) => {
  const num = Number(n);
  return Number.isFinite(num) ? num.toFixed(1) : "—";
};

const pct = (made: unknown, att: unknown) => {
  const a = Number(att);
  const m = Number(made);
  return a > 0 ? `${((m / a) * 100).toFixed(1)}%` : "—";
};

function rowsFrom(r: AvgRow): [[string, string], [string, string]][] {
  return [
    [["PTS", f1(r.avg_pts)], ["FG%", pct(r.avg_fgm, r.avg_fga)]],
    [["REB", f1(r.avg_reb)], ["3P%", pct(r.avg_3pm, r.avg_3pa)]],
    [["AST", f1(r.avg_ast)], ["FT%", pct(r.avg_ftm, r.avg_fta)]],
    [["STL", f1(r.avg_stl)], ["MIN", f1(r.avg_min)]],
    [["BLK", f1(r.avg_blk)], ["TO", f1(r.avg_tov)]],
  ];
}

// Per-game NFL average for a stat column: the matview carries avg_<col>
// directly; historical rows only persist total_<col>, so fall back to
// total / games_played there.
function nflAvg(row: Record<string, unknown>, col: string): string {
  const avg = Number(row[`avg_${col}`]);
  if (Number.isFinite(avg)) return avg.toFixed(1);
  const total = Number(row[`total_${col}`]);
  const gp = Number(row.games_played);
  if (Number.isFinite(total) && gp > 0) return (total / gp).toFixed(1);
  return "—";
}

// NFL box rows are position-shaped: a QB box leads with passing, a kicker
// with FG/XP, a D/ST with takeaways. `position` comes from the players row.
function nflRowsFrom(
  row: Record<string, unknown>,
  position: string | null | undefined,
): [[string, string], [string, string]][] {
  const v = (col: string) => nflAvg(row, col);
  if (position === "QB") {
    return [
      [["PaYD", v("pass_yd")], ["PaTD", v("pass_td")]],
      [["INT", v("pass_int")], ["FUM", v("fum_lost")]],
      [["RuYD", v("rush_yd")], ["RuTD", v("rush_td")]],
    ];
  }
  if (position === "K") {
    return [
      [["FG", v("fg_made")], ["FGA", v("fg_att")]],
      [["XP", v("xp_made")], ["FUM", v("fum_lost")]],
    ];
  }
  if (position === "DST") {
    return [
      [["SCK", v("dst_sacks")], ["INT", v("dst_int")]],
      [["FR", v("dst_fum_rec")], ["TD", v("dst_td")]],
      [["PA", v("dst_pts_allowed")], ["PA PTS", v("dst_pa_pts")]],
    ];
  }
  // RB / WR / TE (and anything else): rushing + receiving.
  return [
    [["RuYD", v("rush_yd")], ["RuTD", v("rush_td")]],
    [["REC", v("rec")], ["TGT", v("targets")]],
    [["ReYD", v("rec_yd")], ["ReTD", v("rec_td")]],
    [["FUM", v("fum_lost")], ["RET TD", v("ret_td")]],
  ];
}

function rowsFromProj(p: ProjectionRow): [[string, string], [string, string]][] {
  return [
    [["PTS", f1(p.proj_pts)], ["FG%", pct(p.proj_fgm, p.proj_fga)]],
    [["REB", f1(p.proj_reb)], ["3P%", pct(p.proj_3pm, p.proj_3pa)]],
    [["AST", f1(p.proj_ast)], ["FT%", pct(p.proj_ftm, p.proj_fta)]],
    [["STL", f1(p.proj_stl)], ["MIN", f1(p.proj_min)]],
    [["BLK", f1(p.proj_blk)], ["TO", f1(p.proj_tov)]],
  ];
}

function StatCell({
  label,
  value,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <View style={styles.cell} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText type="varsitySmall" style={[styles.cellLabel, { color: labelColor }]}>
        {label}
      </ThemedText>
      <ThemedText type="mono" style={[styles.cellValue, { color: valueColor }]}>
        {value}
      </ThemedText>
    </View>
  );
}

/**
 * Player averages box-score with a unified lens selector — recent windows
 * (Last 5/10/15/25 games, pulled from the game log) plus the current season
 * and previous seasons. Picking a lens recomputes the whole box-score, FPTS/G
 * (with a vs-season trend on recent windows), and the situational splits.
 */
export function SeasonAverages({
  player,
  sport,
  currentSeasonLabel,
  currentGamesDenominator,
  avgFpts,
  isCategories,
  historicalStats,
  scoringWeights,
  gameLog,
  projection,
  seasonStarted,
}: SeasonAveragesProps) {
  const c = useColors();
  const isNfl = sport === "nfl";

  const lenses: Lens[] = useMemo(() => {
    const log = gameLog ?? [];
    const out: Lens[] = [];

    // Pre-season: the current season has no games yet, so fold the season-long
    // projection into the "current season" slot rather than show an empty box.
    const projFpts =
      projection && !isCategories && scoringWeights
        ? projAvgRowToFpts(projection as unknown as Record<string, unknown>, scoringWeights, sport)
        : null;
    const seasonProjected = !seasonStarted && !!projection;

    // Recent windows — only when the log actually has that many games, so we
    // don't show "L25" that's identical to a shorter window. Basketball-only:
    // averageGames computes basketball columns, and Lx windows read oddly for
    // a 17-game NFL season.
    if (!isNfl) {
      for (const n of RECENT_WINDOWS) {
        if (log.length < n) continue;
        const slice = log.slice(0, n);
        const avg = averageGames(slice);
        if (!avg) continue;
        out.push({
          key: `L${n}`,
          chip: `L${n}`,
          gpText: `${avg.games_played}`,
          fpts:
            !isCategories && scoringWeights
              ? seasonAvgRowToFpts(avg as unknown as Record<string, unknown>, scoringWeights)
              : null,
          rows: rowsFrom(avg),
          games: slice,
        });
      }
    }

    // Current season — shows the projected line until the season tips off
    // (NFL has no projections v1, so it shows the zero-game box pre-season).
    const seasonRows = seasonProjected
      ? rowsFromProj(projection!)
      : isNfl
        ? nflRowsFrom(player as unknown as Record<string, unknown>, player.position)
        : rowsFrom(player);
    out.push({
      key: "season",
      chip: currentSeasonLabel,
      gpText: seasonProjected
        ? ""
        : `${player.games_played}${currentGamesDenominator ? `/${currentGamesDenominator}` : ""}`,
      fpts: seasonProjected ? projFpts : isCategories ? null : avgFpts,
      rows: seasonRows,
      games: seasonProjected ? [] : log,
      projected: seasonProjected,
    });

    // Previous seasons
    for (const row of historicalStats ?? []) {
      out.push({
        key: row.season,
        chip: row.season,
        gpText: `${row.games_played}`,
        fpts:
          !isCategories && scoringWeights
            ? seasonAvgRowToFpts(row as unknown as Record<string, unknown>, scoringWeights, sport)
            : null,
        rows: isNfl
          ? nflRowsFrom(row as unknown as Record<string, unknown>, player.position)
          : rowsFrom(row),
        games: [],
      });
    }
    // Projected per-game line (season-long projection) as a forward-looking
    // lens, pinned to the front so it sits left of the recent windows. Skipped
    // pre-season — there it's already the current-season slot's content.
    if (projection && !seasonProjected) {
      // Chip carries the season it projects (e.g. "'26 PROJ") so it can't be
      // mistaken for the next-game projection shown in the header strip. Both
      // "2026" and "2025-26" reduce to the season's defining year ("26").
      const yy = projection.season ? String(projection.season).slice(-2) : null;
      out.unshift({
        key: "proj",
        chip: yy ? `'${yy} PROJ` : "PROJ",
        gpText: "",
        fpts: projFpts,
        rows: rowsFromProj(projection),
        games: [],
        projected: true,
      });
    }
    return out;
  }, [
    gameLog,
    historicalStats,
    player,
    avgFpts,
    isCategories,
    scoringWeights,
    currentSeasonLabel,
    currentGamesDenominator,
    projection,
    seasonStarted,
    sport,
    isNfl,
  ]);

  const seasonIdx = Math.max(0, lenses.findIndex((l) => l.key === "season"));
  const [activeKey, setActiveKey] = useState<string>("season");
  const active = lenses.find((l) => l.key === activeKey) ?? lenses[seasonIdx];

  // Trend arrow on recent windows: window FPTS vs season FPTS.
  const trend = useMemo(() => {
    if (!active || active.key === "season" || active.projected || active.fpts == null || avgFpts == null) {
      return null;
    }
    const delta = active.fpts - avgFpts;
    if (Math.abs(delta) < Math.max(1, avgFpts * 0.05)) {
      return { icon: "remove" as const, color: c.secondaryText };
    }
    return delta > 0
      ? { icon: "caret-up" as const, color: c.success }
      : { icon: "caret-down" as const, color: c.danger };
  }, [active, avgFpts, c.success, c.danger, c.secondaryText]);

  if (!active) return null;

  const showChips = lenses.length > 1;

  return (
    <View>
      {showChips && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {lenses.map((lens) => {
            const sel = lens.key === active.key;
            return (
              <Pressable
                key={lens.key}
                onPress={() => setActiveKey(lens.key)}
                style={[
                  styles.chip,
                  { borderColor: c.border },
                  sel && { backgroundColor: c.accent, borderColor: c.accent },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={
                  lens.projected
                    ? `Projected ${lens.chip} season averages`
                    : lens.key.startsWith("L")
                      ? `Last ${lens.chip.slice(1)} games`
                      : `${lens.chip} season`
                }
              >
                <ThemedText
                  type="varsitySmall"
                  style={[styles.chipText, { color: sel ? c.statusText : c.secondaryText }]}
                >
                  {lens.chip}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.metaRow}>
        <ThemedText type="varsitySmall" style={[styles.gp, { color: c.secondaryText }]}>
          {active.projected ? "PROJECTED · SEASON" : `${active.gpText} GP`}
        </ThemedText>
        {active.fpts != null && (
          <View style={styles.fptsCallout}>
            {trend && <Ionicons name={trend.icon} size={ms(15)} color={trend.color} />}
            <ThemedText type="mono" style={[styles.fptsValue, { color: c.accent }]}>
              {Math.round(active.fpts * 10) / 10}
            </ThemedText>
            <ThemedText type="varsitySmall" style={[styles.fptsLabel, { color: c.secondaryText }]}>
              FPTS/G
            </ThemedText>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {active.rows.map((row, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 && { backgroundColor: c.cardAlt }]}>
            <StatCell label={row[0][0]} value={row[0][1]} labelColor={c.secondaryText} valueColor={c.text} />
            <View style={[styles.rowDivider, { backgroundColor: c.border }]} />
            <StatCell label={row[1][0]} value={row[1][1]} labelColor={c.secondaryText} valueColor={c.text} />
          </View>
        ))}
      </View>

      {/* Splits (Home/Away, B2B, Bounce-Back) are FPTS-based — hidden in
          categories leagues, where there are no fantasy points to compare.
          Basketball-only: B2B/bounce-back are schedule-density concepts that
          don't exist in a one-game-a-week NFL season. */}
      {!isCategories && !isNfl && (
        <PlayerSplits games={active.games} scoringWeights={scoringWeights} seasonAvg={avgFpts} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    gap: s(6),
    paddingBottom: s(10),
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: s(5),
    paddingHorizontal: s(11),
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: ms(10),
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(8),
    minHeight: s(26),
  },
  gp: {
    fontSize: ms(9.5),
  },
  fptsCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  fptsValue: {
    fontSize: ms(26),
    letterSpacing: 0,
  },
  fptsLabel: {
    fontSize: ms(9),
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    ...cardShadow,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(6),
  },
  rowDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: s(4),
    opacity: 0.8,
  },
  cell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(12),
  },
  cellLabel: {
    fontSize: ms(10),
    letterSpacing: 1,
  },
  cellValue: {
    fontSize: ms(15),
  },
});
