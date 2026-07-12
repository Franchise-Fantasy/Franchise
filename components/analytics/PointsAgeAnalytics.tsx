import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path as SkiaPath,
  Rect,
  rect,
  Skia,
  Line as SkiaLine,
  vec,
} from "@shopify/react-native-skia";
import { scaleLinear, type ScaleLinear } from "d3-scale";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AnalyticsEmptyState } from "@/components/analytics/AnalyticsEmptyState";
import { DependencyRiskCard } from "@/components/analytics/DependencyRiskCard";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { InfoModal } from "@/components/ui/InfoModal";
import { ThemedText } from "@/components/ui/ThemedText";
import { type PositionCurve } from "@/constants/agingCurves";
import { Brand, Fonts, cardShadow } from "@/constants/Colors";
import { getCurrentSeason, type Sport } from "@/constants/LeagueDefaults";
import { useColors } from "@/hooks/useColors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { usePlayerHistoricalStats } from "@/hooks/usePlayerHistoricalStats";
import { PlayerSeasonStats, ScoringWeight } from "@/types/player";
import { ordinalSuffix } from "@/utils/formatting";
import {
  AgeFptsPoint,
  BUCKET_COLORS,
  PEAK_YEARS,
  ageBucket,
  buildLeagueComparison,
  buildScatterData,
  calculateRosterAgeProfile,
} from "@/utils/roster/rosterAge";
import { getEligiblePositions } from "@/utils/roster/rosterSlots";
import { ms, s } from "@/utils/scale";
import {
  ANALYTICS_MIN_CURRENT_SEASON_GAMES,
  seasonAvgRowToFpts,
} from "@/utils/scoring/fantasyPoints";

// ─── Chart layout ────────────────────────────────────────────────────────────

const PAD = { top: s(16), right: s(12), bottom: s(36), left: s(40) };
const CHART_HEIGHT = s(400);
const DOT_RADIUS = s(6);

/** Tap radius, in screen pixels. Marks render at a fixed size no matter how far
 *  the chart is stretched, so this stays a real 44pt touch target — and
 *  stretching an axis pulls clustered dots apart underneath it, which is the
 *  whole reason to stretch. */
const HIT_RADIUS = s(22);
/** Floor on a pinch's per-axis finger spread. Fingers held level have a vertical
 *  spread near zero, and dividing by that would fling the FPTS axis to infinity.
 *  The floor makes an axis-aligned pinch leave the other axis alone instead. */
const MIN_PINCH_SPAN = 40;
/** How far either axis can stretch past its fitted domain. */
const MAX_AXIS_ZOOM = 10;

/** The slice of data on screen. Each axis is windowed independently — that's
 *  what lets a pinch change the chart's aspect ratio instead of magnifying it. */
type Domain = { x: [number, number]; y: [number, number] };

/** Ages and FPTS are whole numbers at the fitted domain but go fractional once
 *  an axis is stretched, so ticks get at most one decimal. */
function formatTick(t: number): string {
  return Number.isInteger(t) ? String(t) : String(Math.round(t * 10) / 10);
}

// Maps an age bucket to the brand Badge variant. Rising → vintageGold,
// prime → turfGreen, vet → merlot — same palette as AGE_BUCKET_COLORS.
function bucketBadgeVariant(bucket: 'rising' | 'prime' | 'vet'): BadgeVariant {
  if (bucket === 'rising') return 'gold';
  if (bucket === 'prime') return 'turf';
  return 'merlot';
}

interface PointsAgeAnalyticsProps {
  players: PlayerSeasonStats[];
  allPlayers: (PlayerSeasonStats & { team_id: string })[];
  weights: ScoringWeight[] | undefined;
  scoringType: string | undefined;
  prevSeasonFptsMap?: Map<string, number>;
  /** The team being charted — any team in the league, via the analytics TeamRail. */
  teamId: string;
  /** The signed-in user's team. Feeds PlayerDetailModal, whose add/drop actions
   *  must target the user's own roster even while another team is charted. */
  myTeamId: string;
  leagueId: string;
  sport: Sport;
  curveChips: PositionCurve[];
}

/**
 * Age-vs-production analytics for dynasty leagues — the weighted-age narrative,
 * the age/FPTS scatter with career trajectory, and the aging-curve toggle.
 * Extracted from app/analytics.tsx; only dynasty leagues render it.
 */
export function PointsAgeAnalytics({
  players,
  allPlayers,
  weights,
  scoringType,
  prevSeasonFptsMap,
  teamId,
  myTeamId,
  leagueId,
  sport,
  curveChips,
}: PointsAgeAnalyticsProps) {
  const scheme = useColorScheme() ?? "light";
  const c = useColors();
  const isDark = scheme === "dark";

  const [chartWidth, setChartWidth] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState<AgeFptsPoint | null>(
    null,
  );
  // Lags behind selectedPlayer so the detail card can fade its current
  // content out before swapping (cross-fade on switch, fade-out on deselect)
  // instead of popping. The chart dots/labels track selectedPlayer directly.
  const [displayedPlayer, setDisplayedPlayer] = useState<AgeFptsPoint | null>(
    null,
  );
  const [modalPlayer, setModalPlayer] = useState<PlayerSeasonStats | null>(
    null,
  );
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [selectedCurve, setSelectedCurve] = useState<PositionCurve>("ALL");

  const scatterData = useMemo(() => {
    if (!players.length || !weights?.length) return [];
    return buildScatterData(players, weights, prevSeasonFptsMap, ANALYTICS_MIN_CURRENT_SEASON_GAMES);
  }, [players, weights, prevSeasonFptsMap]);

  const profile = useMemo(() => {
    if (!players.length || !weights?.length) return null;
    return calculateRosterAgeProfile(players, weights, prevSeasonFptsMap, ANALYTICS_MIN_CURRENT_SEASON_GAMES);
  }, [players, weights, prevSeasonFptsMap]);

  // League-wide comparison
  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueComparison(
      allPlayers as any,
      weights,
      teamId,
      prevSeasonFptsMap,
      ANALYTICS_MIN_CURRENT_SEASON_GAMES,
    );
  }, [allPlayers, weights, teamId, prevSeasonFptsMap]);

  // Career trajectory for the selected player, plotted on the chart's own
  // age/FPTS axes: each past season becomes a point at (age that year, FPTS
  // that year), ending at the current highlighted dot. Tracks displayedPlayer
  // (not selectedPlayer) so it cross-fades in sync with the detail card and
  // the new query fires only after a switch's fade-out.
  const { data: historicalData } = usePlayerHistoricalStats(
    displayedPlayer?.playerId ?? null,
  );

  const trajectory = useMemo(() => {
    if (!displayedPlayer || !weights?.length) return [];
    const current = getCurrentSeason(sport);
    const currentStartYear = parseInt(current.slice(0, 4), 10);
    // The player's age in a past season = current age minus the seasons since
    // (one year per season). Relies on the YYYY / YYYY-YY season prefix.
    const hist = (historicalData ?? [])
      .filter((r) => r.season !== current)
      .map((r) => {
        const startYear = parseInt(r.season.slice(0, 4), 10);
        return {
          season: r.season,
          age: displayedPlayer.age - (currentStartYear - startYear),
          fpts: seasonAvgRowToFpts(r as unknown as Record<string, unknown>, weights),
        };
      })
      .filter((p) => p.fpts > 0 && Number.isFinite(p.age))
      .sort((a, b) => a.age - b.age);
    const points = [...hist];
    // Reuses the dot's effective fpts/age so the endpoint matches the scatter.
    if (displayedPlayer.avgFpts > 0) {
      points.push({
        season: current,
        age: displayedPlayer.age,
        fpts: displayedPlayer.avgFpts,
      });
    }
    return points;
  }, [historicalData, displayedPlayer, weights, sport]);

  // Detail card animation
  const detailOpacity = useSharedValue(0);
  const detailStyle = useAnimatedStyle(() => ({
    opacity: detailOpacity.value,
    transform: [{ translateY: (1 - detailOpacity.value) * 6 }],
  }));

  // Float the new content in whenever the displayed player changes (first
  // selection or after a switch's fade-out completes and swaps the content).
  useEffect(() => {
    if (displayedPlayer) {
      detailOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [displayedPlayer]);

  // React to selection changes: show immediately when nothing is displayed,
  // otherwise fade the current content out first, then swap (switch) or clear
  // (deselect). Re-runs when displayedPlayer catches up, then no-ops.
  useEffect(() => {
    if (selectedPlayer?.playerId === displayedPlayer?.playerId) return;
    if (!displayedPlayer) {
      setDisplayedPlayer(selectedPlayer);
    } else {
      detailOpacity.value = withTiming(0, { duration: 150 }, (finished) => {
        if (finished) runOnJS(setDisplayedPlayer)(selectedPlayer);
      });
    }
  }, [selectedPlayer, displayedPlayer]);

  const selectPlayer = useCallback(
    (player: AgeFptsPoint | null) => setSelectedPlayer(player),
    [],
  );

  // Dim the non-selected dots/labels when a player is selected, restore on
  // deselect. One shared value drives every faded element (selected stays 1).
  const selectionProgress = useSharedValue(0);
  useEffect(() => {
    selectionProgress.value = withTiming(selectedPlayer ? 1 : 0, {
      duration: 180,
    });
  }, [selectedPlayer]);
  const dimmedDotOpacity = useDerivedValue(
    () => 1 - selectionProgress.value * 0.8,
  );
  const dimmedLabelStyle = useAnimatedStyle(() => ({
    opacity: 1 - selectionProgress.value * 0.75,
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  };

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

  // The fitted domain — the whole roster, and what FIT returns to.
  const baseDomain = useMemo<Domain | null>(() => {
    if (!scatterData.length) return null;

    const ages = scatterData.map((d) => d.age);
    const fpts = scatterData.map((d) => d.avgFpts);
    const minAge = Math.floor(Math.min(...ages)) - 1;
    const maxAge = Math.ceil(Math.max(...ages)) + 1;
    const maxFpts = Math.ceil(Math.max(...fpts) * 1.12);

    // .nice() is applied once, here, rather than on every zoom frame — rounding
    // a live window would make the axes twitch as the fingers move.
    return {
      x: scaleLinear().domain([minAge, maxAge]).nice().domain() as [number, number],
      y: scaleLinear().domain([0, maxFpts]).nice().domain() as [number, number],
    };
  }, [scatterData]);

  // The window currently on screen; null means fitted. The gesture rewrites the
  // domain rather than transforming the rendered chart, so dots, names and ticks
  // all keep their size — stretching an axis reveals structure instead of
  // magnifying pixels.
  const [domain, setDomain] = useState<Domain | null>(null);
  const view = domain ?? baseDomain;
  const isZoomed = domain !== null;

  type Axes = {
    xScale: ScaleLinear<number, number> | null;
    yScale: ScaleLinear<number, number> | null;
    xTicks: number[];
    yTicks: number[];
  };
  const { xScale, yScale, xTicks, yTicks } = useMemo((): Axes => {
    if (!view || plotW <= 0) {
      return { xScale: null, yScale: null, xTicks: [], yTicks: [] };
    }
    const xs = scaleLinear().domain(view.x).range([0, plotW]);
    const ys = scaleLinear().domain(view.y).range([plotH, 0]);
    return {
      xScale: xs,
      yScale: ys,
      xTicks: xs.ticks(5),
      yTicks: ys.ticks(5).filter((t) => t > view.y[0] && t < view.y[1]),
    };
  }, [view, plotW, plotH]);

  // Skia path through the selected player's career (age, fpts) points, in the
  // chart's plot-area coordinate space. Null until there are ≥2 seasons.
  const trajectoryPath = useMemo(() => {
    if (trajectory.length < 2 || !xScale || !yScale) return null;
    const path = Skia.Path.Make();
    trajectory.forEach((p, i) => {
      const x = xScale(p.age);
      const y = yScale(p.fpts);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    return path;
  }, [trajectory, xScale, yScale]);

  // Filter dots by selected position curve. Uses the full eligibility
  // spectrum so a "PG-SG" player matches both PG and SG chips, not just
  // the primary token.
  const filteredScatter = useMemo(() => {
    if (selectedCurve === "ALL") return scatterData;
    const groupMatches: Record<string, string[]> = {
      G: ["PG", "SG"],
      F: ["SF", "PF"],
    };
    const targets = groupMatches[selectedCurve] ?? [selectedCurve];
    return scatterData.filter((d) => {
      if (!d.position) return false;
      const eligible = getEligiblePositions(d.position);
      return targets.some((t) => eligible.includes(t));
    });
  }, [scatterData, selectedCurve]);

  // Dots outside the zoom window are dropped rather than drawn and clipped: the
  // Skia marks would clip fine, but the player-name labels are absolutely
  // positioned RN Text and would otherwise pile up in the axis gutters.
  const visibleScatter = useMemo(() => {
    if (!view) return [];
    return filteredScatter.filter(
      (d) =>
        d.age >= view.x[0] &&
        d.age <= view.x[1] &&
        d.avgFpts >= view.y[0] &&
        d.avgFpts <= view.y[1],
    );
  }, [filteredScatter, view]);

  // When the position-curve filter changes, clear any selected dot and refit —
  // the filtered scatter may no longer include the selection, and a zoom window
  // framed around the old set means nothing for the new one.
  useEffect(() => {
    setSelectedPlayer(null);
    setDomain(null);
  }, [selectedCurve]);

  // Select the dot nearest a tap. Both the touch and the dots are in screen
  // pixels — the chart isn't transformed any more — so a fixed radius means
  // stretching an axis genuinely buys precision: the dots spread apart
  // underneath a touch target that stays the same size.
  const selectAtPoint = useCallback(
    (touchX: number, touchY: number) => {
      if (!xScale || !yScale || !visibleScatter.length) return;

      const adjX = touchX - PAD.left;
      const adjY = touchY - PAD.top;

      let closest: AgeFptsPoint | null = null;
      let closestDist = Infinity;

      for (const point of visibleScatter) {
        const dist = Math.hypot(
          adjX - xScale(point.age),
          adjY - yScale(point.avgFpts),
        );
        if (dist < closestDist) {
          closestDist = dist;
          closest = point;
        }
      }

      if (closest && closestDist < HIT_RADIUS) {
        selectPlayer(
          selectedPlayer?.playerId === closest.playerId ? null : closest,
        );
      } else {
        selectPlayer(null);
      }
    },
    [xScale, yScale, visibleScatter, selectedPlayer, selectPlayer],
  );

  // ── Two-finger stretch ── the gesture worklets run on the UI thread and can't
  // read React state, so the live window is mirrored into a shared value and the
  // gesture snapshots it on touch-down.
  const viewSV = useSharedValue<[number, number, number, number]>([0, 1, 0, 1]);
  useEffect(() => {
    if (view) viewSV.value = [view.x[0], view.x[1], view.y[0], view.y[1]];
  }, [view, viewSV]);

  const startView = useSharedValue<[number, number, number, number]>([0, 1, 0, 1]);
  const startSpanX = useSharedValue(0);
  const startSpanY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);

  const chartGesture = useMemo(() => {
    const bx0 = baseDomain?.x[0] ?? 0;
    const bx1 = baseDomain?.x[1] ?? 1;
    const by0 = baseDomain?.y[0] ?? 0;
    const by1 = baseDomain?.y[1] ?? 1;
    const baseW = bx1 - bx0;
    const baseH = by1 - by0;

    // Horizontal and vertical finger spread are measured separately, so a
    // sideways pinch pulls the age axis apart while leaving FPTS alone, an
    // upward one stretches production, and a diagonal one does both. That's the
    // aspect-ratio change — a uniform magnifier can't separate two players who
    // differ only in age, because it scales the gap and the dot together.
    const stretch = Gesture.Manual()
      .onTouchesDown((e, manager) => {
        if (e.numberOfTouches < 2) return;
        const [a, b] = e.allTouches;
        startSpanX.value = Math.abs(a.x - b.x);
        startSpanY.value = Math.abs(a.y - b.y);
        startFocalX.value = (a.x + b.x) / 2;
        startFocalY.value = (a.y + b.y) / 2;
        startView.value = viewSV.value;
        // Only claim the touch once a second finger lands — a one-finger drag
        // still belongs to the analytics ScrollView.
        manager.activate();
      })
      .onTouchesMove((e) => {
        if (e.numberOfTouches < 2 || plotW <= 0 || plotH <= 0) return;
        const [a, b] = e.allTouches;
        const [sx0, sx1, sy0, sy1] = startView.value;

        const kx =
          Math.max(Math.abs(a.x - b.x), MIN_PINCH_SPAN) /
          Math.max(startSpanX.value, MIN_PINCH_SPAN);
        const ky =
          Math.max(Math.abs(a.y - b.y), MIN_PINCH_SPAN) /
          Math.max(startSpanY.value, MIN_PINCH_SPAN);

        // The window narrows as the fingers spread. Clamped so neither axis
        // stretches past MAX_AXIS_ZOOM or shrinks back past the fitted domain.
        const w = Math.min(baseW, Math.max(baseW / MAX_AXIS_ZOOM, (sx1 - sx0) / kx));
        const h = Math.min(baseH, Math.max(baseH / MAX_AXIS_ZOOM, (sy1 - sy0) / ky));

        // Whatever data sat under the fingers' midpoint when the pinch started
        // stays under it as they move — which makes the pan fall out for free.
        const anchorX = sx0 + ((startFocalX.value - PAD.left) / plotW) * (sx1 - sx0);
        const anchorY = sy1 - ((startFocalY.value - PAD.top) / plotH) * (sy1 - sy0);
        const focalFx = ((a.x + b.x) / 2 - PAD.left) / plotW;
        const focalFy = ((a.y + b.y) / 2 - PAD.top) / plotH;

        let x0 = anchorX - focalFx * w;
        let x1 = x0 + w;
        let y1 = anchorY + focalFy * h;
        let y0 = y1 - h;

        // Keep the window over the data — panning off into blank space is never
        // useful on a scatter this small.
        if (x0 < bx0) { x0 = bx0; x1 = bx0 + w; }
        if (x1 > bx1) { x1 = bx1; x0 = bx1 - w; }
        if (y0 < by0) { y0 = by0; y1 = by0 + h; }
        if (y1 > by1) { y1 = by1; y0 = by1 - h; }

        // Touch events keep firing while fingers rest, and each commit costs a
        // full React render of the chart. Skip the ones that wouldn't move a
        // pixel.
        const [px0, px1, py0, py1] = viewSV.value;
        const epsX = baseW / 2000;
        const epsY = baseH / 2000;
        if (
          Math.abs(x0 - px0) < epsX &&
          Math.abs(x1 - px1) < epsX &&
          Math.abs(y0 - py0) < epsY &&
          Math.abs(y1 - py1) < epsY
        ) {
          return;
        }

        viewSV.value = [x0, x1, y0, y1];
        runOnJS(setDomain)({ x: [x0, x1], y: [y0, y1] });
      })
      .onTouchesUp((e, manager) => {
        if (e.numberOfTouches < 2) manager.end();
      })
      .onTouchesCancelled((_, manager) => manager.end());

    // Bounded so a quick two-finger pinch can't also land as a tap and toggle a
    // selection out from under the stretch.
    const tap = Gesture.Tap()
      .maxDuration(500)
      .maxDistance(s(12))
      .onEnd((e) => {
        runOnJS(selectAtPoint)(e.x, e.y);
      });

    return Gesture.Simultaneous(stretch, tap);
  }, [
    baseDomain,
    plotW,
    plotH,
    selectAtPoint,
    viewSV,
    startView,
    startSpanX,
    startSpanY,
    startFocalX,
    startFocalY,
  ]);

  if (!profile || profile.totalWithAge < 3) {
    return (
      <AnalyticsEmptyState
        title="Not enough age data."
        sub="NEED AT LEAST 3 PLAYERS WITH AGES"
      />
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
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
            ...(Platform.OS === 'android' && { elevation: 0 }),
          },
        ]}
      >
        <View style={[styles.topNotch, { backgroundColor: c.tint }]} />

        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrow, { color: c.secondaryText }]}
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
          {curveChips.map((key) => {
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
          })}
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

      {/* ── Chart ── pinch an axis to stretch it; FIT returns to the full roster. ── */}
      <View style={styles.chartWrap}>
      <GestureDetector gesture={chartGesture}>
        <View
          style={styles.chartArea}
          onLayout={onLayout}
          accessibilityRole="image"
          accessibilityLabel={`Age versus fantasy points scatterplot with ${visibleScatter.length} players, ${selectedCurve} aging curve. Tap a dot for player details. Pinch sideways to stretch the age axis, or up and down to stretch fantasy points, pulling clustered players apart.`}
        >
          {canvasWidth > 0 && xScale && yScale && view ? (
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
              {/* Everything that lives inside the plot rect is clipped to it — a
                  stretched window pushes dots, gridlines and the age markers out
                  past the axes. */}
              <Group clip={rect(0, 0, plotW, plotH)}>
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

                {/* Selected player's career trajectory — past seasons
                    plotted on the same age/FPTS axes, ending at the
                    current dot. */}
                {trajectoryPath && (
                  <Group opacity={detailOpacity}>
                    <SkiaPath
                      path={trajectoryPath}
                      color={c.gold}
                      style="stroke"
                      strokeWidth={2}
                      strokeJoin="round"
                      strokeCap="round"
                    />
                    {trajectory.slice(0, -1).map((p) => (
                      <Circle
                        key={`traj-${p.season}`}
                        cx={xScale(p.age)}
                        cy={yScale(p.fpts)}
                        r={s(3)}
                        color={c.gold}
                      />
                    ))}
                  </Group>
                )}

                {/* Data dots */}
                {visibleScatter.map((point) => {
                  const cx = xScale(point.age);
                  const cy = yScale(point.avgFpts);
                  const bucket = ageBucket(point.age);
                  const color = BUCKET_COLORS[bucket];
                  const isSelected =
                    selectedPlayer?.playerId === point.playerId;

                  return (
                    <Group
                      key={point.playerId}
                      opacity={isSelected ? 1 : dimmedDotOpacity}
                    >
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

                {/* Gap bracket between roster and production age — drawn in the
                    bottom gutter, so it sits outside the plot clip. Hidden while
                    stretched: it spans two markers that a zoom window can push
                    off-screen, and a bracket to nowhere reads as a bug. */}
                {!isZoomed && (() => {
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
                {formatTick(tick)}
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
                {formatTick(tick)}
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

            {/* Gap label — pairs with the bracket above, so it hides on the same
                terms (under 0.5yr apart, or while an axis is stretched). */}
            {!isZoomed && (() => {
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
              const labels = visibleScatter.map((point) => {
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
                  <Animated.Text
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
                      isSelected ? null : dimmedLabelStyle,
                    ]}
                  >
                    {label}
                  </Animated.Text>
                );
              });
            })()}

            </>
          ) : null}
        </View>
      </GestureDetector>

      {/* Sits outside the GestureDetector so pressing it can't also register as
          a tap on the chart underneath. */}
      {isZoomed ? (
        <TouchableOpacity
          style={[styles.fitPill, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => setDomain(null)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Fit chart to the full roster"
        >
          <ThemedText type="varsity" style={[styles.fitPillText, { color: c.text }]}>
            FIT
          </ThemedText>
        </TouchableOpacity>
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
        {displayedPlayer ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              const full = players?.find(
                (p) => p.player_id === displayedPlayer.playerId,
              );
              if (full) setModalPlayer(full);
            }}
            accessibilityRole="button"
            accessibilityLabel={`View ${displayedPlayer.name} details`}
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
                    {displayedPlayer.name}
                  </ThemedText>
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.detailMeta, { color: c.secondaryText }]}
                  >
                    {displayedPlayer.position} · AGE {displayedPlayer.age}
                  </ThemedText>
                  <View style={styles.detailBadges}>
                    <Badge
                      label={
                        ageBucket(displayedPlayer.age) === 'rising'
                          ? 'RISING'
                          : ageBucket(displayedPlayer.age) === 'prime'
                            ? 'PRIME'
                            : 'VETERAN'
                      }
                      variant={bucketBadgeVariant(ageBucket(displayedPlayer.age))}
                      size="small"
                    />
                  </View>
                </View>
                <View style={styles.detailFpts}>
                  <ThemedText
                    type="display"
                    style={[styles.detailFptsValue, { color: c.text }]}
                  >
                    {displayedPlayer.avgFpts}
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

      <DependencyRiskCard
        allPlayers={allPlayers as any}
        weights={weights}
        scoringType={scoringType}
        teamId={teamId}
        leagueId={leagueId}
      />

      {/* ── Info Modal ── */}
      <InfoModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        title="How to Read This Chart"
      >
        <Text style={[styles.modalText, { color: c.secondaryText }]}>
          Each dot is a player on the roster, plotted by age (x-axis) and
          average fantasy points per game (y-axis). Tap any dot to see player
          details.
        </Text>

        <Text style={[styles.modalText, { color: c.secondaryText }]}>
          When players bunch together, pinch to stretch an axis: sideways spreads
          them by age, up and down spreads them by fantasy points. The chart
          re-plots into the stretched window rather than magnifying, so the dots
          move apart while everything stays readable — and easier to tap. FIT
          returns to the full roster.
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
        teamId={myTeamId ?? undefined}
        onClose={() => setModalPlayer(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: s(32),
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

  // Anchors the FIT pill over the chart. The pill is a sibling of the
  // GestureDetector rather than a child, so its press doesn't also land as a
  // chart tap.
  chartWrap: {
    position: "relative",
  },
  // Chart — positioned relative so text overlays work; overflow hidden keeps a
  // half-clipped edge dot from spilling into the axis gutters.
  chartArea: {
    marginBottom: 0,
    position: "relative",
    height: CHART_HEIGHT,
    overflow: "hidden",
  },
  fitPill: {
    position: "absolute",
    top: s(4),
    right: s(4),
    minWidth: s(44),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fitPillText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },

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
    // Floor sits just above the natural populated-content height so the card
    // doesn't resize between the empty hint and a player. minHeight (not a
    // fixed height) still lets it grow gracefully under large-font settings.
    minHeight: s(118),
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
