import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Rect,
  Line as SkiaLine,
  vec,
} from "@shopify/react-native-skia";
import { scaleLinear } from "d3-scale";
import { useCallback, useMemo, useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
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

import { CatAnalytics } from "@/components/analytics/CatAnalytics";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { InfoModal } from "@/components/ui/InfoModal";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { ThemedText } from "@/components/ui/ThemedText";
import {
  type PositionCurve,
} from "@/constants/agingCurves";
import { Brand, Fonts, cardShadow } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useColors } from "@/hooks/useColors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeague } from "@/hooks/useLeague";
import { useLeagueRosterStats } from "@/hooks/useLeagueRosterStats";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { PlayerSeasonStats } from "@/types/player";
import {
  AgeFptsPoint,
  BUCKET_COLORS,
  PEAK_YEARS,
  ageBucket,
  buildLeagueComparison,
  buildScatterData,
  calculateRosterAgeProfile,
} from "@/utils/roster/rosterAge";
import { ms, s } from "@/utils/scale";
import { getPositionCurveKey } from "@/utils/scoring/agingCurve";

// ─── Chart layout ────────────────────────────────────────────────────────────

const PAD = { top: s(16), right: s(12), bottom: s(36), left: s(40) };
const CHART_HEIGHT = s(400);
const DOT_RADIUS = s(6);

// Maps an age bucket to the brand Badge variant. Rising → vintageGold,
// prime → turfGreen, vet → merlot — same palette as AGE_BUCKET_COLORS.
function bucketBadgeVariant(bucket: 'rising' | 'prime' | 'vet'): BadgeVariant {
  if (bucket === 'rising') return 'gold';
  if (bucket === 'prime') return 'turf';
  return 'merlot';
}

// Same helper AnalyticsPreviewCard uses — keeps the ordinal text identical
// across the home preview and the full analytics screen ("3rd", "1st", etc).
function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0]!;
}

export default function AnalyticsScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = useColors();
  const isDark = scheme === "dark";
  const { leagueId, teamId } = useAppState();

  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === "h2h_categories";

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
  const [selectedCurve, setSelectedCurve] = useState<PositionCurve>("ALL");

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

  // Filter dots by selected position curve
  const filteredScatter = useMemo(() => {
    if (selectedCurve === "ALL") return scatterData;
    return scatterData.filter((d) => {
      const key = getPositionCurveKey(d.position);
      if (selectedCurve === "G") return key === "PG" || key === "SG" || key === "G";
      if (selectedCurve === "F") return key === "SF" || key === "PF" || key === "F";
      return key === selectedCurve;
    });
  }, [scatterData, selectedCurve]);

  // Handle dot taps via responder on an overlay View
  const handleTap = useCallback(
    (evt: GestureResponderEvent) => {
      if (!xScale || !yScale || !filteredScatter.length) return;
      const touchX = evt.nativeEvent.locationX;
      const touchY = evt.nativeEvent.locationY;

      const adjX = touchX - PAD.left;
      const adjY = touchY - PAD.top;

      let closest: AgeFptsPoint | null = null;
      let closestDist = Infinity;

      for (const point of filteredScatter) {
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
    [xScale, yScale, filteredScatter, selectedPlayer],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Roster Analytics" />
      <View style={styles.content}>
        {isCategories ? (
          isLoading ? (
            <View style={styles.loading}><LogoSpinner /></View>
          ) : allPlayers && allPlayers.length > 0 ? (
            <CatAnalytics
              allPlayers={allPlayers as any}
              myPlayers={players}
              teamId={teamId!}
              leagueId={leagueId!}
            />
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="display"
                style={[styles.emptyTitle, { color: c.text }]}
              >
                Nothing to chart yet.
              </ThemedText>
              <ThemedText
                type="varsitySmall"
                style={[styles.emptySub, { color: c.secondaryText }]}
              >
                NO LEAGUE DATA · CHECK BACK SOON
              </ThemedText>
            </View>
          )
        ) : isLoading ? (
          <View style={styles.loading}><LogoSpinner /></View>
        ) : !profile || profile.totalWithAge < 3 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="display"
              style={[styles.emptyTitle, { color: c.text }]}
            >
              Not enough age data.
            </ThemedText>
            <ThemedText
              type="varsitySmall"
              style={[styles.emptySub, { color: c.secondaryText }]}
            >
              NEED AT LEAST 3 PLAYERS WITH AGES
            </ThemedText>
          </View>
        ) : (
          <>
            {/* ── Narrative Card ── matches AnalyticsPreviewCard chrome
                (heritage-gold surface + turf notch + column-divider-column),
                adapted to three stat columns. */}
            <View
              style={[
                styles.narrativeCard,
                {
                  backgroundColor: c.heritageGoldMuted,
                  borderColor: c.border,
                  ...cardShadow,
                },
              ]}
            >
              <View style={[styles.topNotch, { backgroundColor: c.primary }]} />

              <ThemedText
                type="varsitySmall"
                style={[styles.eyebrow, { color: c.primary }]}
              >
                CHAMPIONSHIP WINDOW
              </ThemedText>

              {(() => {
                // Same two-column shape AnalyticsPreviewCard uses on the
                // home screen — Weighted Age + League Position. Phrased
                // from whichever end of the age scale is shorter so the
                // ordinal stays small and easily-parsed.
                const vsLeague = comparison
                  ? profile.weightedProductionAge - comparison.leagueAvgWeightedAge
                  : null;
                let rankValue = '—';
                let rankSub = '';
                if (comparison) {
                  const total = comparison.totalTeams;
                  const fromYoungest = comparison.weightedAgeRank <= Math.ceil(total / 2);
                  const n = fromYoungest
                    ? comparison.weightedAgeRank
                    : total - comparison.weightedAgeRank + 1;
                  rankValue = `${n}${ordinalSuffix(n)}`;
                  rankSub = `${fromYoungest ? 'youngest' : 'oldest'} of ${total}`;
                }
                return (
                  <View style={styles.columnsRow}>
                    <View style={styles.column}>
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.columnLabel, { color: c.secondaryText }]}
                      >
                        WEIGHTED AGE
                      </ThemedText>
                      <ThemedText
                        type="display"
                        style={[styles.columnBig, { color: c.text }]}
                        numberOfLines={1}
                      >
                        {profile.weightedProductionAge}
                      </ThemedText>
                      {vsLeague !== null ? (
                        <ThemedText
                          type="varsitySmall"
                          style={[styles.columnSub, { color: c.secondaryText }]}
                        >
                          {`${vsLeague >= 0 ? '+' : ''}${vsLeague.toFixed(1)}YR VS AVG`}
                        </ThemedText>
                      ) : null}
                    </View>

                    <View style={[styles.columnDivider, { backgroundColor: c.border }]} />

                    <View
                      style={styles.column}
                      accessibilityLabel={
                        comparison
                          ? `${rankValue} ${rankSub}`
                          : 'League position unavailable'
                      }
                    >
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.columnLabel, { color: c.secondaryText }]}
                      >
                        LEAGUE POSITION
                      </ThemedText>
                      <ThemedText
                        type="display"
                        style={[styles.columnBig, { color: c.text }]}
                        numberOfLines={1}
                      >
                        {rankValue}
                      </ThemedText>
                      {rankSub ? (
                        <ThemedText
                          type="varsitySmall"
                          style={[styles.columnSub, { color: c.secondaryText }]}
                        >
                          {rankSub.toUpperCase()}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>
                );
              })()}
            </View>

            {/* ── Position Curve Toggle + Info ── WeekRail-style chips on
                the left, info button on the far right (replaces the old
                chart-overlay icon). */}
            <View style={styles.curveToggleRow}>
              <View style={styles.curveToggleChips}>
                {(["ALL", "PG", "SG", "SF", "PF", "C"] as PositionCurve[]).map(
                  (key) => {
                    const active = selectedCurve === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.curveTogglePill,
                          {
                            backgroundColor: active ? c.gold : "transparent",
                            borderColor: active ? c.gold : c.border,
                          },
                        ]}
                        onPress={() => setSelectedCurve(key)}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${key === "ALL" ? "all positions" : key} aging curve`}
                        accessibilityState={{ selected: active }}
                        activeOpacity={0.7}
                      >
                        <ThemedText
                          type="varsity"
                          style={[
                            styles.curveToggleText,
                            { color: active ? Brand.ink : c.secondaryText },
                          ]}
                        >
                          {key}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  },
                )}
              </View>
              <TouchableOpacity
                onPress={() => setInfoModalVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="How to read this chart"
                style={styles.curveToggleInfo}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={ms(20)}
                  color={c.secondaryText}
                  accessible={false}
                />
              </TouchableOpacity>
            </View>

            {/* ── Chart ── */}
            <View
              style={styles.chartArea}
              onLayout={onLayout}
              accessibilityRole="image"
              accessibilityLabel={`Age versus fantasy points scatterplot with ${filteredScatter.length} players, ${selectedCurve} aging curve`}
            >
              {canvasWidth > 0 && xScale && yScale ? (
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
                      {filteredScatter.map((point) => {
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
                    const labels = filteredScatter.map((point) => {
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
                </>
              ) : null}
            </View>

            {/* ── Player Detail Card (always same size) — gold rule
                eyebrow + Alfa Slab name + Badge for bucket. ── */}
            <View
              style={[
                styles.detailCard,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  ...cardShadow,
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
                    <View style={styles.detailEyebrowRow}>
                      <View style={[styles.detailRule, { backgroundColor: c.gold }]} />
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.detailEyebrow, { color: c.secondaryText }]}
                      >
                        PLAYER DETAIL
                      </ThemedText>
                    </View>

                    <View style={styles.detailHeader}>
                      <View style={styles.detailHeaderLeft}>
                        <ThemedText
                          type="display"
                          style={[styles.detailName, { color: c.text }]}
                          numberOfLines={1}
                        >
                          {selectedPlayer.name}
                        </ThemedText>
                        <ThemedText
                          type="varsitySmall"
                          style={[styles.detailMeta, { color: c.secondaryText }]}
                        >
                          {selectedPlayer.position} · AGE {selectedPlayer.age}
                        </ThemedText>
                        <View style={styles.detailBadges}>
                          <Badge
                            label={
                              ageBucket(selectedPlayer.age) === 'rising'
                                ? 'RISING'
                                : ageBucket(selectedPlayer.age) === 'prime'
                                  ? 'PRIME'
                                  : 'VETERAN'
                            }
                            variant={bucketBadgeVariant(ageBucket(selectedPlayer.age))}
                            size="small"
                          />
                        </View>
                      </View>
                      <View style={styles.detailFpts}>
                        <ThemedText
                          type="display"
                          style={[styles.detailFptsValue, { color: c.text }]}
                        >
                          {selectedPlayer.avgFpts}
                        </ThemedText>
                        <ThemedText
                          type="varsitySmall"
                          style={[styles.detailFptsLabel, { color: c.secondaryText }]}
                        >
                          FPTS/G
                        </ThemedText>
                      </View>
                    </View>
                  </Animated.View>
                </TouchableOpacity>
              ) : (
                <View style={styles.detailHintWrap}>
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.detailHint, { color: c.secondaryText }]}
                  >
                    TAP A PLAYER TO SEE DETAILS
                  </ThemedText>
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
      <InfoModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        title="How to Read This Chart"
      >
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

        <Text style={[styles.modalText, { color: c.secondaryText, fontWeight: "600" }]}>
          Aging Curve
        </Text>
        <Text style={[styles.modalText, { color: c.secondaryText }]}>
          The line shows expected production at each age for
          fantasy-relevant players, based on 20+ years of NBA data
          filtered to your league's roster depth. Players above the line
          are outperforming for their age; below means they may be
          developing or declining. The shaded band shows the typical
          range (25th–75th percentile). Use the position pills to
          compare — PGs tend to age more gracefully than SGs.
        </Text>
      </InfoModal>

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
  content: { flex: 1, paddingHorizontal: s(16), paddingTop: s(10) },
  loading: { marginTop: s(40) },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: s(10),
    paddingHorizontal: s(32),
    paddingTop: s(40),
  },
  emptyRule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: "center",
  },
  emptySub: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: "center",
  },

  // Narrative Card — mirrors AnalyticsPreviewCard chrome
  narrativeCard: {
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
  curveToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: s(12),
    paddingHorizontal: 2,
    gap: s(8),
  },
  curveToggleChips: {
    flex: 1,
    flexDirection: "row",
    gap: s(6),
  },
  curveToggleInfo: {
    padding: s(2),
  },
  curveTogglePill: {
    minWidth: s(40),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  curveToggleText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },

  // Chart — positioned relative so text overlays work
  chartArea: { marginBottom: 0, position: "relative", height: CHART_HEIGHT },

  // Absolutely positioned text labels over the Canvas
  axisLabel: {
    position: "absolute",
    fontSize: ms(11),
    fontWeight: "500",
  },
  axisTitleLabel: {
    position: "absolute",
    fontSize: ms(11),
    fontWeight: "700",
  },
  indicatorLabel: {
    position: "absolute",
    fontSize: ms(8),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  playerNameLabel: {
    position: "absolute",
    fontSize: ms(9),
  },

  // Detail Card — gold-rule eyebrow + Alfa Slab name + Badge.
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(14),
    marginBottom: s(8),
    marginTop: s(8),
    minHeight: s(112),
    justifyContent: "center",
  },
  detailEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    marginBottom: s(8),
  },
  detailRule: {
    height: 2,
    width: s(18),
  },
  detailEyebrow: {
    fontSize: ms(9.5),
    letterSpacing: 1.3,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: s(10),
  },
  detailHeaderLeft: {
    flex: 1,
    minWidth: 0,
  },
  detailName: {
    fontFamily: Fonts.display,
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
  detailMeta: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginTop: s(2),
  },
  detailFpts: {
    alignItems: "flex-end",
  },
  detailFptsValue: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
  },
  detailFptsLabel: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    marginTop: s(1),
  },
  detailBadges: {
    flexDirection: "row",
    gap: s(8),
    marginTop: s(8),
  },
  detailHintWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: s(20),
  },
  detailHint: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    textAlign: "center",
  },

  // Info modal content (rendered inside shared InfoModal)
  modalText: {
    fontSize: ms(13),
    lineHeight: ms(19),
    marginBottom: s(12),
  },
  modalSwatchRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: s(5),
    marginBottom: s(12),
  },
  modalSwatch: {
    width: s(10),
    height: s(10),
    borderRadius: 5,
  },
  modalSwatchLabel: {
    fontSize: ms(12),
    fontWeight: "500",
  },

  footnote: { fontSize: ms(10), fontStyle: "italic", textAlign: "center" },
});
