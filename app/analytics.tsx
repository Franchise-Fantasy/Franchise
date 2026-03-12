import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { ThemedText } from "@/components/ThemedText";
import { PageHeader } from "@/components/ui/PageHeader";
import { Colors } from "@/constants/Colors";
import { PlayerSeasonStats } from "@/types/player";
import { useAppState } from "@/context/AppStateProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLeagueRosterStats } from "@/hooks/useLeagueRosterStats";
import {
  AgeFptsPoint,
  BUCKET_COLORS,
  PEAK_YEARS,
  ageBucket,
  buildLeagueComparison,
  buildScatterData,
  calculateRosterAgeProfile,
  getInsightText,
} from "@/utils/rosterAge";
import { isExpoGo } from "@/utils/buildConfig";
import { Ionicons } from "@expo/vector-icons";
import { scaleLinear } from "d3-scale";

// Skia requires native modules — lazy-load to avoid crash in Expo Go.
let Canvas: any = null;
let Circle: any = null;
let DashPathEffect: any = null;
let Group: any = null;
let Rect: any = null;
let SkiaLine: any = null;
let vec: any = null;

if (!isExpoGo) {
  try {
    const skia = require("@shopify/react-native-skia");
    Canvas = skia.Canvas;
    Circle = skia.Circle;
    DashPathEffect = skia.DashPathEffect;
    Group = skia.Group;
    Rect = skia.Rect;
    SkiaLine = skia.Line;
    vec = skia.vec;
  } catch {
    // Native module not available
  }
}
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
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
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Chart layout ────────────────────────────────────────────────────────────

const PAD = { top: 16, right: 12, bottom: 36, left: 40 };
const CHART_HEIGHT = 400;
const DOT_RADIUS = 6;

export default function AnalyticsScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const isDark = scheme === "dark";
  const { leagueId, teamId } = useAppState();

  const { data: allPlayers, isLoading: loadingPlayers } = useLeagueRosterStats(
    leagueId!,
  );
  const { data: weights, isLoading: loadingScoring } = useLeagueScoring(
    leagueId!,
  );

  const [chartWidth, setChartWidth] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState<AgeFptsPoint | null>(
    null,
  );
  const [modalPlayer, setModalPlayer] = useState<PlayerSeasonStats | null>(
    null,
  );
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  // My team's players (for scatter plot + detail modal)
  const players = useMemo(
    () => allPlayers?.filter((p) => p.team_id === teamId) ?? [],
    [allPlayers, teamId],
  );

  const scatterData = useMemo(() => {
    if (!players.length || !weights?.length) return [];
    return buildScatterData(players, weights);
  }, [players, weights]);

  const profile = useMemo(() => {
    if (!players.length || !weights?.length) return null;
    return calculateRosterAgeProfile(players, weights);
  }, [players, weights]);

  // League-wide comparison
  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueComparison(allPlayers as any, weights, teamId);
  }, [allPlayers, weights, teamId]);

  const insight = useMemo(() => {
    if (!profile) return "";
    return getInsightText(profile, comparison);
  }, [profile, comparison]);

  // Detail card animation
  const detailOpacity = useSharedValue(0);
  const detailStyle = useAnimatedStyle(() => ({
    opacity: detailOpacity.value,
    transform: [{ translateY: (1 - detailOpacity.value) * 6 }],
  }));

  const selectPlayer = useCallback((player: AgeFptsPoint | null) => {
    setSelectedPlayer(player);
    detailOpacity.value = withTiming(player ? 1 : 0, { duration: 180 });
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  };

  const isLoading = loadingPlayers || loadingScoring;
  const canvasWidth = chartWidth;
  const plotW = canvasWidth - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const skewsOlder = profile
    ? profile.weightedProductionAge > profile.avgAge
    : false;
  const prodColor = isDark
    ? skewsOlder
      ? "#818CF8"
      : "#60A5FA"
    : skewsOlder
      ? "#6366F1"
      : "#2563EB";

  // Axis label colors
  const axisNumColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";
  const axisTitleColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

  // Scales
  const { xScale, yScale, xTicks, yTicks } = useMemo(() => {
    if (!scatterData.length || plotW <= 0) {
      return { xScale: null, yScale: null, xTicks: [], yTicks: [] };
    }

    const ages = scatterData.map((d) => d.age);
    const fpts = scatterData.map((d) => d.avgFpts);
    const minAge = Math.floor(Math.min(...ages)) - 1;
    const maxAge = Math.ceil(Math.max(...ages)) + 1;
    const maxFpts = Math.ceil(Math.max(...fpts) * 1.12);

    const xs = scaleLinear().domain([minAge, maxAge]).range([0, plotW]).nice();
    const ys = scaleLinear().domain([0, maxFpts]).range([plotH, 0]).nice();

    return {
      xScale: xs,
      yScale: ys,
      xTicks: xs.ticks(Math.min(5, Math.floor((maxAge - minAge) / 2))),
      yTicks: ys.ticks(5).filter((t) => t > 0 && t < maxFpts),
    };
  }, [scatterData, plotW, plotH]);

  // Handle dot taps via responder on an overlay View
  const handleTap = useCallback(
    (evt: GestureResponderEvent) => {
      if (!xScale || !yScale || !scatterData.length) return;
      const touchX = evt.nativeEvent.locationX;
      const touchY = evt.nativeEvent.locationY;

      const adjX = touchX - PAD.left;
      const adjY = touchY - PAD.top;

      let closest: AgeFptsPoint | null = null;
      let closestDist = Infinity;

      for (const point of scatterData) {
        const px = xScale(point.age);
        const py = yScale(point.avgFpts);
        const dist = Math.sqrt((adjX - px) ** 2 + (adjY - py) ** 2);
        if (dist < closestDist) {
          closestDist = dist;
          closest = point;
        }
      }

      if (closest && closestDist < 35) {
        selectPlayer(
          selectedPlayer?.playerId === closest.playerId ? null : closest,
        );
      } else {
        selectPlayer(null);
      }
    },
    [xScale, yScale, scatterData, selectedPlayer],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Roster Analytics" />
      <View style={styles.content}>
        {isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !profile || profile.totalWithAge < 3 ? (
          <View style={styles.emptyState}>
            <ThemedText style={{ color: c.secondaryText }}>
              Not enough age data to display analytics
            </ThemedText>
          </View>
        ) : (
          <>
            {/* ── Narrative Card ── */}
            <View
              style={[
                styles.windowCard,
                {
                  backgroundColor: isDark
                    ? "rgba(96,165,250,0.06)"
                    : "rgba(96,165,250,0.05)",
                  borderColor: isDark
                    ? "rgba(96,165,250,0.15)"
                    : "rgba(96,165,250,0.2)",
                },
              ]}
            >
              <Text
                style={[
                  styles.windowLabel,
                  { color: isDark ? "#60A5FA" : "#2563EB" },
                ]}
              >
                CHAMPIONSHIP WINDOW
              </Text>

              <View style={styles.agePillRow}>
                {/* Weighted Age pill */}
                <View
                  style={[
                    styles.agePill,
                    {
                      backgroundColor: skewsOlder
                        ? isDark
                          ? "rgba(129,140,248,0.08)"
                          : "rgba(99,102,241,0.06)"
                        : isDark
                          ? "rgba(96,165,250,0.08)"
                          : "rgba(37,99,235,0.06)",
                      borderWidth: 1,
                      borderColor: skewsOlder
                        ? isDark
                          ? "rgba(129,140,248,0.15)"
                          : "rgba(99,102,241,0.15)"
                        : isDark
                          ? "rgba(96,165,250,0.15)"
                          : "rgba(37,99,235,0.15)",
                    },
                  ]}
                >
                  <Text
                    style={[styles.agePillLabel, { color: c.secondaryText }]}
                  >
                    WEIGHTED AGE
                  </Text>
                  <Text style={[styles.agePillValue, { color: prodColor }]}>
                    {profile.weightedProductionAge}
                  </Text>
                </View>

                {/* League Rank pill */}
                <View
                  style={[
                    styles.agePill,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(0,0,0,0.03)",
                    },
                  ]}
                >
                  <Text
                    style={[styles.agePillLabel, { color: c.secondaryText }]}
                  >
                    LEAGUE RANK
                  </Text>
                  <ThemedText style={styles.agePillValue}>
                    {comparison
                      ? `#${comparison.weightedAgeRank}`
                      : "—"}
                  </ThemedText>
                  {comparison && (
                    <Text
                      style={[styles.agePillSub, { color: c.secondaryText }]}
                    >
                      of {comparison.totalTeams}
                    </Text>
                  )}
                </View>

                {/* VS League pill */}
                <View
                  style={[
                    styles.agePill,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(0,0,0,0.03)",
                    },
                  ]}
                >
                  <Text
                    style={[styles.agePillLabel, { color: c.secondaryText }]}
                  >
                    VS LEAGUE
                  </Text>
                  <ThemedText style={styles.agePillValue}>
                    {comparison
                      ? `${(profile.weightedProductionAge - comparison.leagueAvgWeightedAge) >= 0 ? "+" : ""}${(profile.weightedProductionAge - comparison.leagueAvgWeightedAge).toFixed(1)}`
                      : "—"}
                  </ThemedText>
                  {comparison && (
                    <Text
                      style={[styles.agePillSub, { color: c.secondaryText }]}
                    >
                      yr
                    </Text>
                  )}
                </View>
              </View>

              <Text style={[styles.windowInsight, { color: c.secondaryText }]}>
                {insight}
              </Text>

              <View style={styles.bucketRow}>
                <Text
                  style={[styles.bucketText, { color: BUCKET_COLORS.rising }]}
                >
                  {profile.risingCount} rising
                </Text>
                <Text style={[styles.bucketDot, { color: c.secondaryText }]}>
                  {" · "}
                </Text>
                <Text
                  style={[styles.bucketText, { color: BUCKET_COLORS.prime }]}
                >
                  {profile.primeCount} prime
                </Text>
                <Text style={[styles.bucketDot, { color: c.secondaryText }]}>
                  {" · "}
                </Text>
                <Text style={[styles.bucketText, { color: BUCKET_COLORS.vet }]}>
                  {profile.vetCount} veteran
                </Text>
              </View>
            </View>

            {/* ── Chart ── */}
            <View
              style={styles.chartArea}
              onLayout={onLayout}
              accessibilityRole="image"
              accessibilityLabel={`Age versus fantasy points scatterplot with ${scatterData.length} players`}
            >
              {!Canvas ? (
                  <View style={styles.emptyState}>
                    <ThemedText style={{ color: c.secondaryText }}>
                      Charts require a development build
                    </ThemedText>
                  </View>
              ) : canvasWidth > 0 && xScale && yScale ? (
                <>
                  {/* Skia Canvas — graphics only, no text */}
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

                      {/* Horizontal grid lines */}
                      {yTicks.map((tick) => (
                        <Group key={`grid-${tick}`}>
                          <SkiaLine
                            p1={vec(0, yScale(tick))}
                            p2={vec(plotW, yScale(tick))}
                            color={gridColor}
                            strokeWidth={1}
                          >
                            <DashPathEffect intervals={[3, 4]} />
                          </SkiaLine>
                        </Group>
                      ))}

                      {/* (axis lines and tick marks removed — just numbers + titles) */}

                      {/* Roster age vertical line */}
                      <SkiaLine
                        p1={vec(xScale(profile.avgAge), 0)}
                        p2={vec(xScale(profile.avgAge), plotH)}
                        color={isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.12)"}
                        strokeWidth={1}
                      >
                        <DashPathEffect intervals={[4, 3]} />
                      </SkiaLine>

                      {/* Production age vertical line */}
                      <SkiaLine
                        p1={vec(xScale(profile.weightedProductionAge), 0)}
                        p2={vec(xScale(profile.weightedProductionAge), plotH)}
                        color={prodColor}
                        strokeWidth={1.5}
                      >
                        <DashPathEffect intervals={[4, 3]} />
                      </SkiaLine>

                      {/* Gap line between roster and production age (hidden if <0.5yr apart) */}
                      {(() => {
                        const diff = Math.abs(profile.weightedProductionAge - profile.avgAge);
                        if (diff < 0.5) return null;
                        const x1 = xScale(profile.avgAge);
                        const x2 = xScale(profile.weightedProductionAge);
                        const gapY = plotH + 4 + 3;
                        return (
                          <SkiaLine
                            p1={vec(x1, gapY)}
                            p2={vec(x2, gapY)}
                            color={prodColor + "66"}
                            strokeWidth={1.5}
                          />
                        );
                      })()}

                      {/* Data dots */}
                      {scatterData.map((point) => {
                        const cx = xScale(point.age);
                        const cy = yScale(point.avgFpts);
                        const bucket = ageBucket(point.age);
                        const color = BUCKET_COLORS[bucket];
                        const isSelected =
                          selectedPlayer?.playerId === point.playerId;

                        return (
                          <Group key={point.playerId}>
                            <Circle
                              cx={cx}
                              cy={cy}
                              r={DOT_RADIUS + (isSelected ? 2 : 0.5)}
                              color={
                                isSelected
                                  ? "#FFFFFF"
                                  : isDark
                                    ? "rgba(255,255,255,0.15)"
                                    : "rgba(0,0,0,0.08)"
                              }
                              style="stroke"
                              strokeWidth={isSelected ? 2 : 1}
                            />
                            <Circle
                              cx={cx}
                              cy={cy}
                              r={DOT_RADIUS}
                              color={color}
                            />
                          </Group>
                        );
                      })}
                    </Group>
                  </Canvas>

                  {/* ── RN Text overlays (absolutely positioned over Canvas) ── */}

                  {/* X axis number labels */}
                  {xTicks.map((tick) => (
                    <Text
                      key={`xl-${tick}`}
                      style={[
                        styles.axisLabel,
                        {
                          color: axisNumColor,
                          left: PAD.left + xScale(tick) - 12,
                          top: PAD.top + plotH + 4 + 2,
                          width: 24,
                          textAlign: "center",
                        },
                      ]}
                    >
                      {tick}
                    </Text>
                  ))}

                  {/* X axis title */}
                  <Text
                    style={[
                      styles.axisTitleLabel,
                      {
                        color: axisTitleColor,
                        left: PAD.left + plotW / 2 - 15,
                        top: PAD.top + plotH + 4 + 18,
                      },
                    ]}
                  >
                    Age
                  </Text>

                  {/* Y axis number labels */}
                  {yTicks.map((tick) => (
                    <Text
                      key={`yl-${tick}`}
                      style={[
                        styles.axisLabel,
                        {
                          color: axisNumColor,
                          left: 0,
                          top: PAD.top + yScale(tick) - 7,
                          width: PAD.left - 4 - 2,
                          textAlign: "right",
                        },
                      ]}
                    >
                      {tick}
                    </Text>
                  ))}

                  {/* Y axis title — vertical along left edge */}
                  <Text
                    style={[
                      styles.axisTitleLabel,
                      {
                        color: axisTitleColor,
                        left: -10,
                        top: PAD.top + plotH / 2 - 20,
                        transform: [{ rotate: "-90deg" }],
                      },
                    ]}
                  >
                    FPTS/G
                  </Text>

                  {/* Gap label between roster and production age lines (hidden if <0.5yr apart) */}
                  {(() => {
                    const diff = profile.weightedProductionAge - profile.avgAge;
                    if (Math.abs(diff) < 0.5) return null;
                    const x1 = xScale(profile.avgAge);
                    const x2 = xScale(profile.weightedProductionAge);
                    const label = `${diff > 0 ? "+" : ""}${diff.toFixed(1)}yr`;
                    return (
                      <Text
                        style={[
                          styles.indicatorLabel,
                          {
                            color: prodColor,
                            left: PAD.left + (x1 + x2) / 2 - 14,
                            top: PAD.top + plotH + 4 - 5,
                          },
                        ]}
                      >
                        {label}
                      </Text>
                    );
                  })()}

                  {/* Player name labels — nudged to avoid overlaps */}
                  {(() => {
                    // Compute initial label positions
                    const labels = scatterData.map((point) => {
                      const cx = xScale(point.age);
                      const cy = yScale(point.avgFpts);
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

                    // Multi-pass collision resolution
                    const LABEL_H = 13;
                    for (let pass = 0; pass < 3; pass++) {
                      for (let i = 0; i < labels.length; i++) {
                        for (let j = i + 1; j < labels.length; j++) {
                          const a = labels[i];
                          const b = labels[j];
                          const overlapX =
                            a.x < b.x + b.w && a.x + a.w > b.x;
                          const overlapY =
                            Math.abs(a.y - b.y) < LABEL_H;
                          if (overlapX && overlapY) {
                            // Push the one that's lower on screen further down
                            const target = a.y >= b.y ? a : b;
                            const other = a.y >= b.y ? b : a;
                            target.y = other.y + LABEL_H;
                          }
                        }
                      }
                    }

                    return labels.map(({ point, label, x, y }) => {
                      const isSelected =
                        selectedPlayer?.playerId === point.playerId;
                      return (
                        <Text
                          key={`name-${point.playerId}`}
                          style={[
                            styles.playerNameLabel,
                            {
                              color: isSelected
                                ? isDark
                                  ? "#FFFFFF"
                                  : c.text
                                : isDark
                                  ? "rgba(255,255,255,0.55)"
                                  : "rgba(0,0,0,0.45)",
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

                  {/* Touch overlay — captures taps on dots */}
                  <View
                    style={[StyleSheet.absoluteFill, { zIndex: 10 }]}
                    onStartShouldSetResponder={() => true}
                    onResponderRelease={handleTap}
                  />

                  {/* Info icon — top right of chart */}
                  <TouchableOpacity
                    style={styles.infoIcon}
                    onPress={() => setInfoModalVisible(true)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="How to read this chart"
                  >
                    <Ionicons
                      name="information-circle-outline"
                      size={20}
                      color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)"}
                      accessible={false}
                    />
                  </TouchableOpacity>
                </>
              ) : null}
            </View>

            {/* ── Player Detail Card (always same size) ── */}
            <View
              style={[
                styles.detailCard,
                {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(0,0,0,0.02)",
                  borderColor: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.06)",
                },
              ]}
            >
              {selectedPlayer ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    const full = players?.find(
                      (p) => p.player_id === selectedPlayer.playerId,
                    );
                    if (full) setModalPlayer(full);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${selectedPlayer.name} details`}
                >
                  <Animated.View style={detailStyle}>
                    <View style={styles.detailHeader}>
                      <View>
                        <ThemedText style={styles.detailName}>
                          {selectedPlayer.name}
                        </ThemedText>
                        <Text
                          style={[styles.detailMeta, { color: c.secondaryText }]}
                        >
                          {selectedPlayer.position} · Age {selectedPlayer.age}
                        </Text>
                      </View>
                      <View style={styles.detailFpts}>
                        <Text
                          style={[
                            styles.detailFptsValue,
                            {
                              color: BUCKET_COLORS[ageBucket(selectedPlayer.age)],
                            },
                          ]}
                        >
                          {selectedPlayer.avgFpts}
                        </Text>
                        <Text
                          style={[
                            styles.detailFptsLabel,
                            { color: c.secondaryText },
                          ]}
                        >
                          FPTS/G
                        </Text>
                      </View>
                    </View>
                    <View style={styles.detailBadges}>
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor:
                              BUCKET_COLORS[ageBucket(selectedPlayer.age)] + "18",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            {
                              color: BUCKET_COLORS[ageBucket(selectedPlayer.age)],
                            },
                          ]}
                        >
                          {ageBucket(selectedPlayer.age) === "rising"
                            ? "Rising"
                            : ageBucket(selectedPlayer.age) === "prime"
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

            {profile.totalWithAge < (players?.length ?? 0) && (
              <Text style={[styles.footnote, { color: c.secondaryText }]}>
                {profile.totalWithAge} of {players?.length} players have age
                data
              </Text>
            )}
          </>
        )}
      </View>

      {/* ── Info Modal ── */}
      <Modal
        visible={infoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setInfoModalVisible(false)}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: isDark ? "#1C1C1E" : "#FFFFFF",
                borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                How to Read This Chart
              </Text>
              <TouchableOpacity
                onPress={() => setInfoModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close info"
              >
                <Ionicons name="close" size={20} color={c.secondaryText} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalText, { color: c.secondaryText }]}>
              Each dot is a player on your roster, plotted by age (x-axis) and
              average fantasy points per game (y-axis). Tap any dot to see player
              details.
            </Text>

            <View style={styles.modalSwatchRow}>
              <View style={[styles.modalSwatch, { backgroundColor: BUCKET_COLORS.rising }]} />
              <Text style={[styles.modalSwatchLabel, { color: c.secondaryText }]}>
                {"Rising (<25)"}
              </Text>
              <View style={[styles.modalSwatch, { backgroundColor: BUCKET_COLORS.prime, marginLeft: 12 }]} />
              <Text style={[styles.modalSwatchLabel, { color: c.secondaryText }]}>
                Prime (25–30)
              </Text>
              <View style={[styles.modalSwatch, { backgroundColor: BUCKET_COLORS.vet, marginLeft: 12 }]} />
              <Text style={[styles.modalSwatchLabel, { color: c.secondaryText }]}>
                Veteran (31+)
              </Text>
            </View>

            <Text style={[styles.modalText, { color: c.secondaryText }]}>
              The dashed line shows your roster's weighted age — the average age
              weighted by each player's fantasy output. The shaded zone highlights
              prime years (25–29).
            </Text>

            <Text style={[styles.modalText, { color: c.secondaryText }]}>
              If weighted age is lower than roster age, your production skews
              young — a prime window may be ahead. If higher, your best output
              comes from older players — a win-now window.
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <PlayerDetailModal
        player={modalPlayer}
        leagueId={leagueId ?? ""}
        teamId={teamId ?? undefined}
        onClose={() => setModalPlayer(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  loading: { marginTop: 40 },
  emptyState: { alignItems: "center", marginTop: 40 },

  // Narrative Card
  windowCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  windowLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  agePillRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  agePill: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  agePillLabel: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  agePillValue: { fontSize: 22, fontWeight: "700" },
  agePillSub: { fontSize: 9, fontWeight: "500", marginTop: 1 },
  windowInsight: { fontSize: 12, lineHeight: 18, marginBottom: 8 },
  bucketRow: { flexDirection: "row", alignItems: "center" },
  bucketText: { fontSize: 12, fontWeight: "600" },
  bucketDot: { fontSize: 12 },

  // Chart — positioned relative so text overlays work
  chartArea: { marginBottom: 0, position: "relative", height: CHART_HEIGHT },

  // Absolutely positioned text labels over the Canvas
  axisLabel: {
    position: "absolute",
    fontSize: 11,
    fontWeight: "500",
  },
  axisTitleLabel: {
    position: "absolute",
    fontSize: 11,
    fontWeight: "700",
  },
  indicatorLabel: {
    position: "absolute",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  playerNameLabel: {
    position: "absolute",
    fontSize: 9,
  },

  // Detail Card
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    marginTop: 8,
    height: 96,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  detailName: { fontSize: 15, fontWeight: "700" },
  detailMeta: { fontSize: 12, marginTop: 2 },
  detailFpts: { alignItems: "flex-end" },
  detailFptsValue: { fontSize: 18, fontWeight: "700" },
  detailFptsLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.5 },
  detailBadges: { flexDirection: "row", gap: 8, marginTop: 8 },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  detailHintWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  detailHint: { fontSize: 12, textAlign: "center" },

  // Info icon on chart
  infoIcon: {
    position: "absolute",
    top: 4,
    right: 4,
    zIndex: 20,
    padding: 4,
  },

  // Info modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 360,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalText: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  modalSwatchRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 12,
  },
  modalSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modalSwatchLabel: {
    fontSize: 12,
    fontWeight: "500",
  },

  footnote: { fontSize: 10, fontStyle: "italic", textAlign: "center" },
});
