/**
 * CAT league analytics — three swipable sections:
 *   1. Radar: Team vs league category comparison
 *   2. Age Scatter: Age vs stat (with stat picker + composite default)
 *   3. Age Tiers: Per-category production breakdown by Rising/Prime/Vet
 */

import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  Path as SkiaPath,
  Rect,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import { scaleLinear } from "d3-scale";
import { useCallback, useMemo, useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { InfoModal } from "@/components/ui/InfoModal";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerSeasonStats } from "@/types/player";
import {
  ageBucket,
  BUCKET_COLORS,
  PEAK_YEARS,
} from "@/utils/roster/rosterAge";
import { ms, s } from "@/utils/scale";
import {
  AgeTierBreakdown,
  buildAgeTierBreakdown,
  buildCompositeScatter,
  buildCatScatterData,
  buildRadarData,
  CatName,
  CAT_ORDER,
  CatScatterPoint,
  computeTeamCategoryAvgs,
  computeTeamZScores,
  RadarPoint,
} from "@/utils/scoring/categoryAnalytics";

// ─── Constants ──────────────────────────────────────────────────────────────

const PAD = { top: s(16), right: s(12), bottom: s(36), left: s(40) };
const CHART_HEIGHT = s(360);
const DOT_RADIUS = s(6);

const STAT_LABELS: Record<string, string> = {
  PTS: "PTS/G",
  REB: "REB/G",
  AST: "AST/G",
  STL: "STL/G",
  BLK: "BLK/G",
  TO: "TO/G",
  "3PM": "3PM/G",
  "FG%": "FG%",
  "FT%": "FT%",
  COMPOSITE: "Overall",
};

type Section = "radar" | "scatter" | "tiers";

interface CatAnalyticsProps {
  allPlayers: (PlayerSeasonStats & { team_id: string })[];
  myPlayers: PlayerSeasonStats[];
  teamId: string;
  leagueId: string;
}

export function CatAnalytics({
  allPlayers,
  myPlayers,
  teamId,
  leagueId,
}: CatAnalyticsProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const isDark = scheme === "dark";

  const [section, setSection] = useState<Section>("radar");
  const [scatterStat, setScatterStat] = useState<CatName | "COMPOSITE">(
    "COMPOSITE"
  );
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedDot, setSelectedDot] = useState<CatScatterPoint | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [modalPlayer, setModalPlayer] = useState<PlayerSeasonStats | null>(
    null
  );

  // ── Computed data ──

  const teamAvgs = useMemo(
    () => computeTeamCategoryAvgs(allPlayers),
    [allPlayers]
  );

  const radarData = useMemo(
    () => buildRadarData(teamAvgs, teamId),
    [teamAvgs, teamId]
  );

  const zScores = useMemo(
    () => computeTeamZScores(teamAvgs, teamId),
    [teamAvgs, teamId]
  );

  const scatterData = useMemo(() => {
    if (scatterStat === "COMPOSITE") return buildCompositeScatter(myPlayers);
    return buildCatScatterData(myPlayers, scatterStat);
  }, [myPlayers, scatterStat]);

  const ageTiers = useMemo(
    () => buildAgeTierBreakdown(myPlayers),
    [myPlayers]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  };

  // ── Render ──

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Section tabs */}
      <View style={styles.tabRow}>
        {(
          [
            { key: "radar", label: "Radar" },
            { key: "scatter", label: "Age" },
            { key: "tiers", label: "Breakdown" },
          ] as const
        ).map(({ key, label }) => {
          const active = section === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.tab,
                active && { borderBottomColor: c.accent, borderBottomWidth: 2 },
              ]}
              onPress={() => setSection(key as Section)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label} tab`}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? c.accent : c.secondaryText },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          onPress={() => setInfoVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`Info about ${section} section`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ justifyContent: "center", paddingLeft: 4 }}
        >
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={c.secondaryText}
          />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {section === "radar" && radarData && (
        <RadarSection
          data={radarData}
          zScores={zScores}
          colors={c}
          isDark={isDark}
        />
      )}

      {section === "scatter" && (
        <ScatterSection
          data={scatterData}
          stat={scatterStat}
          onChangeStat={setScatterStat}
          chartWidth={chartWidth}
          onLayout={onLayout}
          selectedDot={selectedDot}
          onSelectDot={setSelectedDot}
          myPlayers={myPlayers}
          onOpenPlayer={setModalPlayer}
          colors={c}
          isDark={isDark}
        />
      )}

      {section === "tiers" && (
        <TiersSection data={ageTiers} colors={c} isDark={isDark} />
      )}

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title={
          section === "radar"
            ? "Category Radar"
            : section === "scatter"
              ? "Age vs Production"
              : "Age Breakdown"
        }
        message={
          section === "radar"
            ? "The radar chart shows how your team compares to the league average across all 9 categories.\n\n" +
              "Blue = your team, gray = league average. The further out a point, the better you are in that category relative to the league.\n\n" +
              "For turnovers (TO ↓), the chart is flipped — further out means fewer turnovers, which is better.\n\n" +
              "LEAGUE STANDING\n" +
              "Below the radar is your league standing per category, using labels from Elite to Punt.\n\n" +
              "HOW IT WORKS\n" +
              "We compare your team's total output in each category against every other team in the league using z-scores — a stat that measures how far above or below the league average you are.\n\n" +
              "• Elite (+1.5 or more) — Dominant, top of the league\n" +
              "• Strong (+0.75 to +1.5) — Well above average\n" +
              "• Above Avg (+0.25 to +0.75) — Slight edge\n" +
              "• Average (−0.25 to +0.25) — Middle of the pack\n" +
              "• Below Avg (−0.75 to −0.25) — Slight disadvantage\n" +
              "• Weak (−1.5 to −0.75) — Well below average\n" +
              "• Punt (below −1.5) — Consider punting this category"
            : section === "scatter"
              ? "Each dot is a player on your roster, colored by age tier:\n\n" +
                "• Green = Rising (under 25)\n" +
                "• Blue = Prime (25–30)\n" +
                "• Orange = Veteran (31+)\n\n" +
                "Use the stat picker to view individual categories (PTS, REB, etc.) or 'ALL' for a combined score.\n\n" +
                "The 'ALL' composite works by z-scoring each player's stats against your roster — measuring how many standard deviations above or below the team average they are in each category — then summing across all 9. A higher number means the player contributes more across the board.\n\n" +
                "The shaded zone highlights prime years (25–30). Tap any dot to see player details."
              : "This shows what share of your team's production in each category comes from Rising, Prime, and Veteran players.\n\n" +
                "For counting stats (PTS, REB, etc.), the values are summed per-game averages. For percentage stats (FG%, FT%), the values are volume-weighted team rates.\n\n" +
                "If one age group dominates a category, you may be vulnerable to age-related decline (veterans) or inconsistency (rising players)."
        }
      />

      <PlayerDetailModal
        player={modalPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => setModalPlayer(null)}
      />
    </ScrollView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// RADAR SECTION
// ═════════════════════════════════════════════════════════════════════════════

function RadarSection({
  data,
  zScores,
  colors: c,
  isDark,
}: {
  data: RadarPoint[];
  zScores: { cat: CatName; zScore: number }[];
  colors: typeof Colors["light"];
  isDark: boolean;
}) {
  const size = 260;
  const labelMargin = 44; // space for labels outside the chart
  const wrapSize = size + labelMargin * 2;
  const cx = wrapSize / 2;
  const cy = wrapSize / 2;
  const radius = size / 2 - 20;
  const n = data.length;

  const angleStep = (2 * Math.PI) / n;
  // Start from the top (–π/2)
  const angles = data.map((_, i) => -Math.PI / 2 + i * angleStep);

  const toXY = (angle: number, r: number) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });

  // Build polygon path
  const buildPolygon = (values: number[]) => {
    const path = Skia.Path.Make();
    values.forEach((v, i) => {
      const { x, y } = toXY(angles[i], v * radius);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.close();
    return path;
  };

  const myPath = buildPolygon(data.map((d) => d.myNorm));
  const leaguePath = buildPolygon(data.map((d) => d.leagueNorm));

  const myColor = isDark ? "#60A5FA" : "#2563EB";
  const leagueColor = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)";

  return (
    <View accessibilityLabel="Radar chart comparing your team to league averages">
      {/* Chart */}
      <View style={styles.radarWrap}>
        <Canvas style={{ width: wrapSize, height: wrapSize }}>
          {/* Grid rings */}
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <Circle
              key={r}
              cx={cx}
              cy={cy}
              r={r * radius}
              color={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}
              style="stroke"
              strokeWidth={1}
            />
          ))}
          {/* Grid spokes */}
          {angles.map((angle, i) => {
            const outer = toXY(angle, radius);
            return (
              <SkiaLine
                key={i}
                p1={vec(cx, cy)}
                p2={vec(outer.x, outer.y)}
                color={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}
                strokeWidth={1}
              />
            );
          })}
          {/* League polygon */}
          <SkiaPath
            path={leaguePath}
            color={leagueColor}
            style="fill"
            opacity={0.15}
          />
          <SkiaPath
            path={leaguePath}
            color={leagueColor}
            style="stroke"
            strokeWidth={1}
          />
          {/* My team polygon */}
          <SkiaPath
            path={myPath}
            color={myColor}
            style="fill"
            opacity={0.12}
          />
          <SkiaPath
            path={myPath}
            color={myColor}
            style="stroke"
            strokeWidth={2}
          />
          {/* My team dots */}
          {data.map((d, i) => {
            const { x, y } = toXY(angles[i], d.myNorm * radius);
            return (
              <Circle
                key={d.cat}
                cx={x}
                cy={y}
                r={3.5}
                color={myColor}
              />
            );
          })}
        </Canvas>

        {/* Category labels — positioned based on angle around the circle */}
        {data.map((d, i) => {
          const labelR = radius + 16;
          const { x, y } = toXY(angles[i], labelR);
          const lx = x - cx;
          const ly = y - cy;
          const labelText = d.cat + (d.inverse ? " ↓" : "");
          const labelW = 48;

          // Alignment based on hemisphere
          const isRight = lx > 5;
          const isLeft = lx < -5;
          const textAlign = isRight ? "left" as const : isLeft ? "right" as const : "center" as const;

          return (
            <Text
              key={d.cat}
              style={[
                styles.radarLabel,
                {
                  left: isRight ? x + 4 : isLeft ? x - labelW - 4 : x - labelW / 2,
                  top: ly < -5 ? y - 15 : ly > 5 ? y + 2 : y - 7,
                  width: labelW,
                  textAlign,
                  color: c.text,
                },
              ]}
            >
              {labelText}
            </Text>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.radarLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: myColor }]} />
          <Text style={[styles.legendText, { color: c.secondaryText }]}>
            Your Team
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: leagueColor }]} />
          <Text style={[styles.legendText, { color: c.secondaryText }]}>
            League Avg
          </Text>
        </View>
      </View>

      {/* Z-Score table */}
      <View
        style={[
          styles.zTable,
          {
            backgroundColor: isDark
              ? "rgba(255,255,255,0.03)"
              : "rgba(0,0,0,0.02)",
            borderColor: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.06)",
          },
        ]}
      >
        <Text style={[styles.zTableTitle, { color: c.secondaryText }]}>
          LEAGUE STANDING
        </Text>
        <View style={styles.zGrid}>
          {zScores.map((z) => {
            const isPositive = z.zScore >= 0;
            const barColor = isPositive
              ? isDark
                ? "#34D399"
                : "#059669"
              : isDark
                ? "#F87171"
                : "#DC2626";
            const label =
              z.zScore >= 1.5 ? "Elite" :
              z.zScore >= 0.75 ? "Strong" :
              z.zScore >= 0.25 ? "Above Avg" :
              z.zScore > -0.25 ? "Average" :
              z.zScore > -0.75 ? "Below Avg" :
              z.zScore > -1.5 ? "Weak" : "Punt";
            return (
              <View key={z.cat} style={styles.zRow} accessibilityLabel={`${z.cat}: ${label}`}>
                <Text style={[styles.zCatLabel, { color: c.secondaryText }]}>
                  {z.cat}
                </Text>
                <View style={styles.zBarWrap}>
                  {/* Left half (negative) */}
                  <View style={styles.zBarHalf}>
                    {!isPositive && (
                      <View
                        style={[
                          styles.zBar,
                          {
                            width: `${Math.min(Math.abs(z.zScore) * 50, 100)}%`,
                            backgroundColor: barColor + "30",
                            alignSelf: "flex-end",
                          },
                        ]}
                      />
                    )}
                  </View>
                  {/* Center line */}
                  <View style={[styles.zBarCenter, {
                    backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
                  }]} />
                  {/* Right half (positive) */}
                  <View style={styles.zBarHalf}>
                    {isPositive && (
                      <View
                        style={[
                          styles.zBar,
                          {
                            width: `${Math.min(Math.abs(z.zScore) * 50, 100)}%`,
                            backgroundColor: barColor + "30",
                            alignSelf: "flex-start",
                          },
                        ]}
                      />
                    )}
                  </View>
                </View>
                <Text
                  style={[
                    styles.zValue,
                    { color: barColor, fontWeight: "700" },
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCATTER SECTION
// ═════════════════════════════════════════════════════════════════════════════

function ScatterSection({
  data,
  stat,
  onChangeStat,
  chartWidth: canvasWidth,
  onLayout,
  selectedDot,
  onSelectDot,
  myPlayers,
  onOpenPlayer,
  colors: c,
  isDark,
}: {
  data: CatScatterPoint[];
  stat: CatName | "COMPOSITE";
  onChangeStat: (s: CatName | "COMPOSITE") => void;
  chartWidth: number;
  onLayout: (e: LayoutChangeEvent) => void;
  selectedDot: CatScatterPoint | null;
  onSelectDot: (p: CatScatterPoint | null) => void;
  myPlayers: PlayerSeasonStats[];
  onOpenPlayer: (p: PlayerSeasonStats) => void;
  colors: typeof Colors["light"];
  isDark: boolean;
}) {
  const plotW = canvasWidth - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const { xScale, yScale, xTicks, yTicks } = useMemo(() => {
    if (!data.length || plotW <= 0) {
      return { xScale: null, yScale: null, xTicks: [], yTicks: [] };
    }
    const ages = data.map((d) => d.age);
    const vals = data.map((d) => d.value);

    const xS = scaleLinear()
      .domain([Math.min(...ages) - 1, Math.max(...ages) + 1])
      .range([0, plotW])
      .nice();
    const yS = scaleLinear()
      .domain([Math.min(...vals, 0), Math.max(...vals) * 1.12])
      .range([plotH, 0])
      .nice();
    return {
      xScale: xS,
      yScale: yS,
      xTicks: xS.ticks(5),
      yTicks: yS.ticks(5),
    };
  }, [data, plotW, plotH]);

  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const axisNumColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";

  const detailOpacity = useSharedValue(selectedDot ? 1 : 0);
  const detailStyle = useAnimatedStyle(() => ({
    opacity: detailOpacity.value,
    transform: [{ translateY: (1 - detailOpacity.value) * 6 }],
  }));

  const handleTap = useCallback(
    (e: GestureResponderEvent) => {
      if (!xScale || !yScale) return;
      const { locationX, locationY } = e.nativeEvent;
      const px = locationX - PAD.left;
      const py = locationY - PAD.top;

      let closest: CatScatterPoint | null = null;
      let closestDist = 35;
      for (const point of data) {
        const dx = xScale(point.age) - px;
        const dy = yScale(point.value) - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          closestDist = dist;
          closest = point;
        }
      }

      if (closest) {
        const isDeselect = selectedDot?.playerId === closest.playerId;
        onSelectDot(isDeselect ? null : closest);
        detailOpacity.value = withTiming(isDeselect ? 0 : 1, { duration: 200 });
      } else {
        onSelectDot(null);
        detailOpacity.value = withTiming(0, { duration: 150 });
      }
    },
    [xScale, yScale, data, selectedDot]
  );

  const statOptions: (CatName | "COMPOSITE")[] = ["COMPOSITE", ...CAT_ORDER];

  return (
    <View>
      {/* Stat picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statPickerRow}
      >
        {statOptions.map((s) => {
          const active = stat === s;
          return (
            <TouchableOpacity
              key={s}
              style={[
                styles.statPill,
                {
                  backgroundColor: active
                    ? isDark
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(0,0,0,0.08)"
                    : "transparent",
                  borderColor: active
                    ? isDark
                      ? "rgba(255,255,255,0.2)"
                      : "rgba(0,0,0,0.15)"
                    : isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.06)",
                },
              ]}
              onPress={() => {
                onChangeStat(s);
                onSelectDot(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show age vs ${s === "COMPOSITE" ? "composite z-score" : s}`}
            >
              <Text
                style={[
                  styles.statPillText,
                  {
                    color: active ? c.text : c.secondaryText,
                    fontWeight: active ? "700" : "500",
                  },
                ]}
              >
                {s === "COMPOSITE" ? "ALL" : s}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Chart */}
      <View
        style={styles.chartArea}
        onLayout={onLayout}
        accessibilityRole="image"
        accessibilityLabel={`Age versus ${stat === "COMPOSITE" ? "composite value" : stat} scatter plot`}
      >
        {canvasWidth > 0 && xScale && yScale ? (
          <>
            <Canvas
              style={{ width: canvasWidth, height: CHART_HEIGHT }}
              pointerEvents="none"
            >
              <Group
                transform={[
                  { translateX: PAD.left },
                  { translateY: PAD.top },
                ]}
              >
                {/* Prime zone */}
                {(() => {
                  const primeLeft = Math.max(0, xScale(PEAK_YEARS.start));
                  const primeRight = Math.min(plotW, xScale(PEAK_YEARS.end));
                  if (primeRight <= primeLeft) return null;
                  return (
                    <Rect
                      x={primeLeft}
                      y={0}
                      width={primeRight - primeLeft}
                      height={plotH}
                      color={BUCKET_COLORS.prime}
                      opacity={isDark ? 0.045 : 0.04}
                    />
                  );
                })()}

                {/* Grid lines */}
                {yTicks.map((tick) => (
                  <SkiaLine
                    key={`grid-${tick}`}
                    p1={vec(0, yScale(tick))}
                    p2={vec(plotW, yScale(tick))}
                    color={gridColor}
                    strokeWidth={1}
                  >
                    <DashPathEffect intervals={[3, 4]} />
                  </SkiaLine>
                ))}

                {/* Data dots */}
                {data.map((point) => {
                  const px = xScale(point.age);
                  const py = yScale(point.value);
                  const bucketColor =
                    BUCKET_COLORS[ageBucket(point.age)];
                  const isSelected =
                    selectedDot?.playerId === point.playerId;
                  return (
                    <Group key={point.playerId}>
                      {isSelected && (
                        <Circle
                          cx={px}
                          cy={py}
                          r={DOT_RADIUS + 2}
                          color="#FFFFFF"
                          style="stroke"
                          strokeWidth={2}
                        />
                      )}
                      <Circle
                        cx={px}
                        cy={py}
                        r={DOT_RADIUS}
                        color={bucketColor}
                      />
                    </Group>
                  );
                })}
              </Group>
            </Canvas>

            {/* Axis labels */}
            {xTicks.map((tick) => (
              <Text
                key={`x-${tick}`}
                style={[
                  styles.axisLabel,
                  {
                    color: axisNumColor,
                    left: PAD.left + xScale(tick) - 10,
                    top: PAD.top + plotH + 6,
                  },
                ]}
              >
                {tick}
              </Text>
            ))}
            {yTicks.map((tick) => (
              <Text
                key={`y-${tick}`}
                style={[
                  styles.axisLabel,
                  {
                    color: axisNumColor,
                    left: 0,
                    top: PAD.top + yScale(tick) - 7,
                    width: PAD.left - 4,
                    textAlign: "right",
                  },
                ]}
              >
                {stat === "COMPOSITE"
                  ? tick.toFixed(1)
                  : stat === "FG%" || stat === "FT%"
                    ? tick.toFixed(0)
                    : tick.toFixed(1)}
              </Text>
            ))}

            {/* Y axis title */}
            <Text
              style={[
                styles.axisTitleLabel,
                {
                  color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
                  left: -10,
                  top: PAD.top + plotH / 2 - 20,
                  transform: [{ rotate: "-90deg" }],
                },
              ]}
            >
              {STAT_LABELS[stat] ?? stat}
            </Text>

            {/* Player name labels */}
            {(() => {
              const labels = data.map((point) => {
                const cx = xScale(point.age);
                const cy = yScale(point.value);
                const label = point.shortName;
                const labelW = label.length * 5.5;
                return {
                  point,
                  label,
                  x: PAD.left + cx - labelW / 2,
                  y: PAD.top + cy - DOT_RADIUS - 14,
                  w: labelW,
                };
              });

              const LABEL_H = 13;
              for (let pass = 0; pass < 3; pass++) {
                for (let i = 0; i < labels.length; i++) {
                  for (let j = i + 1; j < labels.length; j++) {
                    const a = labels[i];
                    const b = labels[j];
                    if (a.x < b.x + b.w && a.x + a.w > b.x && Math.abs(a.y - b.y) < LABEL_H) {
                      const target = a.y >= b.y ? a : b;
                      const other = a.y >= b.y ? b : a;
                      target.y = other.y + LABEL_H;
                    }
                  }
                }
              }

              return labels.map(({ point, label, x, y }) => {
                const isSelected = selectedDot?.playerId === point.playerId;
                return (
                  <Text
                    key={`name-${point.playerId}`}
                    style={[
                      styles.playerNameLabel,
                      {
                        color: isSelected
                          ? isDark ? "#FFFFFF" : c.text
                          : isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)",
                        left: x,
                        top: y,
                        fontWeight: isSelected ? "700" : "600",
                      },
                    ]}
                  >
                    {label}
                  </Text>
                );
              });
            })()}

            {/* Touch overlay */}
            <View
              style={[StyleSheet.absoluteFill, { zIndex: 10 }]}
              onStartShouldSetResponder={() => true}
              onResponderRelease={handleTap}
            />
          </>
        ) : null}
      </View>

      {/* Detail card */}
      <View
        style={[
          styles.detailCard,
          {
            backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
            borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
          },
        ]}
      >
        {selectedDot ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              const full = myPlayers.find((p) => p.player_id === selectedDot.playerId);
              if (full) onOpenPlayer(full);
            }}
            accessibilityRole="button"
            accessibilityLabel={`View ${selectedDot.name} details`}
          >
            <Animated.View style={detailStyle}>
              <View style={styles.detailHeader}>
                <View>
                  <ThemedText style={styles.detailName}>{selectedDot.name}</ThemedText>
                  <Text style={[styles.detailMeta, { color: c.secondaryText }]}>
                    {selectedDot.position} · Age {selectedDot.age}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      styles.detailValue,
                      { color: BUCKET_COLORS[ageBucket(selectedDot.age)] },
                    ]}
                  >
                    {stat === "FG%" || stat === "FT%"
                      ? selectedDot.value.toFixed(1) + "%"
                      : selectedDot.value.toFixed(1)}
                  </Text>
                  <Text style={[styles.detailValueLabel, { color: c.secondaryText }]}>
                    {STAT_LABELS[stat] ?? stat}
                  </Text>
                </View>
              </View>
              <View style={styles.detailBadges}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        BUCKET_COLORS[ageBucket(selectedDot.age)] + "18",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: BUCKET_COLORS[ageBucket(selectedDot.age)] },
                    ]}
                  >
                    {ageBucket(selectedDot.age) === "rising"
                      ? "Rising"
                      : ageBucket(selectedDot.age) === "prime"
                        ? "Prime"
                        : "Veteran"}
                  </Text>
                </View>
              </View>
            </Animated.View>
          </TouchableOpacity>
        ) : (
          <View style={styles.detailHintWrap}>
            <Text style={[styles.detailHint, { color: c.secondaryText }]}>
              Tap a player to see details
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AGE TIERS SECTION
// ═════════════════════════════════════════════════════════════════════════════

function TiersSection({
  data,
  colors: c,
  isDark,
}: {
  data: AgeTierBreakdown[];
  colors: typeof Colors["light"];
  isDark: boolean;
}) {
  const pctCats = new Set(["FG%", "FT%"]);

  return (
    <View accessibilityLabel="Category production breakdown by age tier">
      <Text style={[styles.tiersSubtitle, { color: c.secondaryText }]}>
        Where your category production comes from
      </Text>

      {/* Column headers */}
      <View style={styles.tierHeaderRow}>
        <Text style={[styles.tierHeaderCat, { color: c.secondaryText }]} />
        <View style={styles.tierBarWrap} />
        <View style={styles.tierValues}>
          <Text style={[styles.tierHeaderLabel, { color: BUCKET_COLORS.rising }]}>Rising</Text>
          <Text style={[styles.tierHeaderLabel, { color: BUCKET_COLORS.prime }]}>Prime</Text>
          <Text style={[styles.tierHeaderLabel, { color: BUCKET_COLORS.vet }]}>Vet</Text>
        </View>
      </View>

      {data.map((row) => {
        const isPct = pctCats.has(row.cat);
        return (
          <View
            key={row.cat}
            style={[
              styles.tierRow,
              {
                borderBottomColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.06)",
              },
            ]}
            accessibilityLabel={`${row.cat}: ${row.risingPct}% rising, ${row.primePct}% prime, ${row.vetPct}% veteran`}
          >
            <Text style={[styles.tierCat, { color: c.text }]}>{row.cat}</Text>

            {/* Stacked bar */}
            <View style={styles.tierBarWrap}>
              {row.risingPct > 0 && (
                <View
                  style={[
                    styles.tierBarSegment,
                    {
                      flex: row.risingPct,
                      backgroundColor: BUCKET_COLORS.rising + (isDark ? "50" : "40"),
                    },
                  ]}
                />
              )}
              {row.primePct > 0 && (
                <View
                  style={[
                    styles.tierBarSegment,
                    {
                      flex: row.primePct,
                      backgroundColor: BUCKET_COLORS.prime + (isDark ? "50" : "40"),
                    },
                  ]}
                />
              )}
              {row.vetPct > 0 && (
                <View
                  style={[
                    styles.tierBarSegment,
                    {
                      flex: row.vetPct,
                      backgroundColor: BUCKET_COLORS.vet + (isDark ? "50" : "40"),
                    },
                  ]}
                />
              )}
            </View>

            {/* Values */}
            <View style={styles.tierValues}>
              <Text style={[styles.tierVal, { color: BUCKET_COLORS.rising }]}>
                {isPct ? `${row.rising.toFixed(1)}%` : row.rising.toFixed(1)}
              </Text>
              <Text style={[styles.tierVal, { color: BUCKET_COLORS.prime }]}>
                {isPct ? `${row.prime.toFixed(1)}%` : row.prime.toFixed(1)}
              </Text>
              <Text style={[styles.tierVal, { color: BUCKET_COLORS.vet }]}>
                {isPct ? `${row.vet.toFixed(1)}%` : row.vet.toFixed(1)}
              </Text>
            </View>
          </View>
        );
      })}

      {/* Legend */}
      <View style={styles.tiersLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: BUCKET_COLORS.rising }]} />
          <Text style={[styles.legendText, { color: c.secondaryText }]}>
            {"Rising (<25)"}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: BUCKET_COLORS.prime }]} />
          <Text style={[styles.legendText, { color: c.secondaryText }]}>
            Prime (25-30)
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: BUCKET_COLORS.vet }]} />
          <Text style={[styles.legendText, { color: c.secondaryText }]}>
            Veteran (31+)
          </Text>
        </View>
      </View>

      <Text style={[styles.tierFootnote, { color: c.secondaryText }]}>
        Counting stats show summed per-game averages. Percentages show
        volume-weighted team rates. Bar width shows share of total
        {" "}production (or attempts for %).
      </Text>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: s(40) },

  // Tab bar
  tabRow: {
    flexDirection: "row",
    marginBottom: s(16),
    gap: s(4),
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: s(8),
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: ms(13), fontWeight: "600" },

  // Radar
  radarWrap: {
    alignSelf: "center",
    position: "relative",
    marginBottom: s(8),
  },
  radarLabel: {
    position: "absolute",
    fontSize: ms(10),
    fontWeight: "700",
  },
  radarLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: s(16),
    marginBottom: s(16),
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: s(5) },
  legendSwatch: { width: s(10), height: s(10), borderRadius: 5 },
  legendText: { fontSize: ms(11), fontWeight: "500" },

  // Z-Score table
  zTable: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(14),
    marginBottom: s(8),
  },
  zTableTitle: {
    fontSize: ms(10),
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: s(10),
  },
  zGrid: { gap: s(6) },
  zRow: { flexDirection: "row", alignItems: "center", gap: s(8) },
  zCatLabel: { fontSize: ms(11), fontWeight: "600", width: s(32) },
  zBarWrap: {
    flex: 1,
    height: s(12),
    flexDirection: "row",
    alignItems: "center",
  },
  zBarHalf: {
    flex: 1,
    height: "100%",
    borderRadius: 4,
    overflow: "hidden",
  },
  zBarCenter: { width: 1, height: "100%" },
  zBar: { height: "100%", borderRadius: 4 },
  zValue: { fontSize: ms(10), width: s(56), textAlign: "right" },

  // Scatter
  statPickerRow: { gap: s(6), paddingHorizontal: s(2), marginBottom: s(10) },
  statPill: {
    paddingVertical: s(4),
    paddingHorizontal: s(10),
    borderRadius: 12,
    borderWidth: 1,
  },
  statPillText: { fontSize: ms(11), letterSpacing: 0.3 },
  chartArea: { position: "relative", height: CHART_HEIGHT, marginBottom: 0 },
  axisLabel: { position: "absolute", fontSize: ms(11), fontWeight: "500" },
  axisTitleLabel: { position: "absolute", fontSize: ms(11), fontWeight: "700" },
  playerNameLabel: { position: "absolute", fontSize: ms(9) },

  // Detail card
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(14),
    marginBottom: s(8),
    marginTop: s(8),
    height: s(96),
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  detailName: { fontSize: ms(15), fontWeight: "700" },
  detailMeta: { fontSize: ms(12), marginTop: s(2) },
  detailValue: { fontSize: ms(18), fontWeight: "700" },
  detailValueLabel: { fontSize: ms(9), fontWeight: "600", letterSpacing: 0.5 },
  detailBadges: { flexDirection: "row", gap: s(8), marginTop: s(8) },
  badge: { paddingVertical: s(3), paddingHorizontal: s(8), borderRadius: 6 },
  badgeText: { fontSize: ms(11), fontWeight: "600" },
  detailHintWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  detailHint: { fontSize: ms(12), textAlign: "center" },

  // Age Tiers
  tiersSubtitle: { fontSize: ms(12), marginBottom: s(8) },
  tierHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    marginBottom: s(2),
  },
  tierHeaderCat: { width: s(32) },
  tierHeaderLabel: { fontSize: ms(9), fontWeight: "700", width: s(40), textAlign: "right" },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(10),
    borderBottomWidth: 1,
    gap: s(8),
  },
  tierCat: { fontSize: ms(12), fontWeight: "700", width: s(32) },
  tierBarWrap: {
    flex: 1,
    height: s(16),
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row",
  },
  tierBarSegment: { height: "100%" },
  tierValues: { flexDirection: "row", gap: s(6), width: s(130) },
  tierVal: { fontSize: ms(11), fontWeight: "600", width: s(40), textAlign: "right" },
  tiersLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: s(12),
    marginTop: s(14),
    marginBottom: s(8),
  },
  tierFootnote: { fontSize: ms(10), fontStyle: "italic", textAlign: "center", lineHeight: ms(15) },
});
