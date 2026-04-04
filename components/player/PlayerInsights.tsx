import { ms, s } from "@/utils/scale";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { TREND_COLORS } from "@/constants/StatusColors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerGameLog, ScoringWeight } from "@/types/player";
import {
  B2BInsight,
  BounceBack,
  calculateB2BImpact,
  calculateBounceBack,
  calculateCategoryInsights,
  calculateHomeSplit,
  calculatePlayerInsights,
  CategoryInsight,
  ConsistencyLabel,
  SplitComparison,
  TrendDirection,
} from "@/utils/playerInsights";
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, TouchableOpacity, View } from "react-native";

interface Props {
  games: PlayerGameLog[] | undefined;
  scoringWeights: ScoringWeight[] | undefined;
  seasonAvg: number | null;
  recentWindow: number;
  onRecentWindowChange: (window: number) => void;
  colors: {
    border: string;
    secondaryText: string;
    accent: string;
    card: string;
  };
  scoringType?: string;
}

const CONSISTENCY_COLORS: Record<ConsistencyLabel, string> = {
  "Rock Solid": TREND_COLORS.cold,
  Steady: TREND_COLORS.neutral,
  Variable: TREND_COLORS.hot,
  "Boom or Bust": TREND_COLORS.scorching,
};

const TREND_CONFIG: Record<
  TrendDirection,
  { label: string; color: string; icon: string }
> = {
  scorching: { label: "Scorching", color: TREND_COLORS.scorching, icon: "▲▲" },
  hot: { label: "Hot", color: TREND_COLORS.hot, icon: "▲" },
  neutral: { label: "Stable", color: TREND_COLORS.neutral, icon: "—" },
  cold: { label: "Cold", color: TREND_COLORS.cold, icon: "▼" },
  frigid: { label: "Frigid", color: TREND_COLORS.frigid, icon: "▼▼" },
};

const CONSISTENCY_RANK: Record<ConsistencyLabel, number> = {
  "Rock Solid": 0,
  Steady: 1,
  Variable: 2,
  "Boom or Bust": 3,
};

const PCT_STATS = new Set(["FG%", "FT%"]);

function formatCatValue(stat_name: string, value: number): string {
  if (PCT_STATS.has(stat_name)) return `${value}%`;
  return String(value);
}

export function PlayerInsightsCard({
  games,
  scoringWeights,
  seasonAvg,
  recentWindow,
  onRecentWindowChange,
  colors,
  scoringType,
}: Props) {
  const isCategories = scoringType === "h2h_categories";

  // Build categories from scoringWeights for CAT leagues
  const categories = useMemo(() => {
    if (!isCategories || !scoringWeights) return null;
    return scoringWeights.map((w) => ({
      stat_name: w.stat_name,
      inverse: w.inverse ?? false,
    }));
  }, [isCategories, scoringWeights]);

  // Points insights (skip for CAT leagues)
  const insights = useMemo(() => {
    if (isCategories || !games || !scoringWeights || seasonAvg == null)
      return null;
    return calculatePlayerInsights(games, scoringWeights, seasonAvg, recentWindow);
  }, [isCategories, games, scoringWeights, seasonAvg, recentWindow]);

  const homeSplit = useMemo(() => {
    if (isCategories || !games || !scoringWeights) return null;
    return calculateHomeSplit(games, scoringWeights);
  }, [isCategories, games, scoringWeights]);

  const b2b = useMemo(() => {
    if (isCategories || !games || !scoringWeights) return null;
    return calculateB2BImpact(games, scoringWeights);
  }, [isCategories, games, scoringWeights]);

  const bounceBack = useMemo(() => {
    if (isCategories || !games || !scoringWeights || seasonAvg == null)
      return null;
    return calculateBounceBack(games, scoringWeights, seasonAvg);
  }, [isCategories, games, scoringWeights, seasonAvg]);

  // CAT insights
  const catInsights = useMemo(() => {
    if (!isCategories || !games || !categories) return null;
    return calculateCategoryInsights(games, categories, recentWindow);
  }, [isCategories, games, categories, recentWindow]);

  const scheme = useColorScheme() ?? "light";

  const [expanded, setExpanded] = useState(false);
  const [catTab, setCatTab] = useState<"strengths" | "trends">("strengths");
  const [showWindowPicker, setShowWindowPicker] = useState(false);

  // --- CAT league branch ---
  if (isCategories) {
    if (!catInsights) return null;

    // Fixed canonical order so every player's layout is consistent
    const CAT_ORDER: Record<string, number> = {
      PTS: 0, REB: 1, AST: 2, STL: 3, BLK: 4, TO: 5, "3PM": 6, "FG%": 7, "FT%": 8,
    };
    const canonicalSort = (a: { stat_name: string }, b: { stat_name: string }) =>
      (CAT_ORDER[a.stat_name] ?? 99) - (CAT_ORDER[b.stat_name] ?? 99);

    const strengthsSorted = [...catInsights.categories].sort(canonicalSort);
    const trendsSorted = [...catInsights.categories].sort(canonicalSort);

    const minTrendCfg = TREND_CONFIG[catInsights.minutesTrend];

    return (
      <View
        style={styles.container}
        accessibilityLabel="Category insights"
        accessibilityRole="summary"
      >
        {/* Tab bar */}
        <View style={styles.catTabBar}>
          {(["strengths", "trends"] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setCatTab(tab)}
              style={[
                styles.catTab,
                catTab === tab && {
                  borderBottomColor: colors.accent,
                  borderBottomWidth: 2,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: catTab === tab }}
              accessibilityLabel={`${tab === "strengths" ? "Strengths" : "Trends"} tab`}
            >
              <ThemedText
                style={[
                  styles.catTabText,
                  {
                    color:
                      catTab === tab ? colors.accent : colors.secondaryText,
                  },
                ]}
              >
                {tab === "strengths" ? "Strengths" : "Trends"}
              </ThemedText>
            </Pressable>
          ))}
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                "Category Insights",
                "Strengths — Per-category consistency, sorted by reliability:\n" +
                  "• Rock Solid: Very consistent output\n" +
                  "• Steady: Reliable most nights\n" +
                  "• Variable: Notable swings\n" +
                  "• Boom or Bust: Huge range\n\n" +
                  "↓ — Inverse stat (lower is better, e.g. turnovers).\n\n" +
                  "Trends — How each category is trending recently vs season average.\n\n" +
                  "For inverse stats, trend colors are flipped — a downward trend shows green.\n\n" +
                  "Tap the filter icon to change the recent games window.",
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Category insights info"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ justifyContent: "center", paddingHorizontal: s(8) }}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.secondaryText} />
          </TouchableOpacity>
        </View>

        {catTab === "strengths" ? (
          <View style={styles.catContent}>
            {strengthsSorted.map((cat) => (
              <CategoryStrengthRow
                key={cat.stat_name}
                cat={cat}
                colors={colors}
              />
            ))}
          </View>
        ) : (
          <View style={styles.catContent}>
            {/* Filter picker for trends */}
            <View style={styles.recentHeader}>
              <ThemedText style={[styles.recentTitle, { color: colors.secondaryText }]}>
                vs. Season Avg
              </ThemedText>
              <View>
                <TouchableOpacity
                  onPress={() => setShowWindowPicker((v) => !v)}
                  style={[styles.windowPickerBtn, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Trend window: last ${recentWindow} games. Tap to change.`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="filter-outline" size={12} color={colors.secondaryText} />
                  <ThemedText style={[styles.windowPickerLabel, { color: colors.secondaryText }]}>
                    {recentWindow}
                  </ThemedText>
                </TouchableOpacity>
                {showWindowPicker && (
                  <>
                    <TouchableOpacity
                      style={styles.windowDropdownBackdrop}
                      activeOpacity={1}
                      onPress={() => setShowWindowPicker(false)}
                      accessibilityLabel="Close window picker"
                    />
                    <View
                      style={[styles.windowDropdown, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      {[5, 10, 15, 25, 50].map((w) => (
                        <TouchableOpacity
                          key={w}
                          onPress={() => {
                            onRecentWindowChange(w);
                            setShowWindowPicker(false);
                          }}
                          style={[
                            styles.windowDropdownItem,
                            w === recentWindow && { backgroundColor: colors.accent },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: w === recentWindow }}
                          accessibilityLabel={`Last ${w} games`}
                        >
                          <ThemedText
                            style={[
                              styles.windowDropdownText,
                              { color: colors.secondaryText },
                              w === recentWindow && { color: Colors[scheme].statusText },
                            ]}
                          >
                            {w}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </View>
            </View>
            {trendsSorted.map((cat) => (
              <CategoryTrendRow
                key={cat.stat_name}
                cat={cat}
                recentWindow={recentWindow}
                colors={colors}
              />
            ))}
            {/* Minutes trend */}
            <View
              style={styles.catRow}
              accessibilityLabel={`Minutes ${minTrendCfg.label}, ${catInsights.minutesDelta > 0 ? "up" : "down"} ${Math.abs(catInsights.minutesDelta)}`}
            >
              <View style={styles.catStatNameWrap}>
                <ThemedText style={styles.catStatName}>MIN</ThemedText>
              </View>
              <View style={styles.catTrendInfo}>
                <View style={styles.trendBox}>
                  <ThemedText
                    style={[styles.trendIcon, { color: minTrendCfg.color }]}
                  >
                    {minTrendCfg.icon}
                  </ThemedText>
                  <ThemedText
                    style={[styles.trendLabel, { color: minTrendCfg.color }]}
                  >
                    {minTrendCfg.label}
                  </ThemedText>
                </View>
                <ThemedText
                  style={[styles.catDelta, { color: minTrendCfg.color }]}
                >
                  {catInsights.minutesDelta > 0 ? "+" : ""}
                  {catInsights.minutesDelta}
                </ThemedText>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  }

  // --- Points league branch (existing) ---
  if (!insights) return null;

  const badgeColor = CONSISTENCY_COLORS[insights.consistency];
  const trendCfg = TREND_CONFIG[insights.trend];
  const minTrendCfg = TREND_CONFIG[insights.minutesTrend];

  // Range bar percentages
  const range = insights.high - insights.low;
  const avgPct =
    range > 0
      ? Math.min(100, Math.max(0, ((seasonAvg! - insights.low) / range) * 100))
      : 50;
  const floorPct =
    range > 0 ? ((insights.floor - insights.low) / range) * 100 : 25;
  const ceilPct =
    range > 0 ? ((insights.ceiling - insights.low) / range) * 100 : 75;

  const hasExtras = !!homeSplit || !!b2b || !!bounceBack;

  return (
    <View
      style={styles.container}
      accessibilityLabel={`Player insights: ${insights.consistency} consistency, standard deviation of ${insights.stdDev} fantasy points per game`}
      accessibilityRole="summary"
    >
      {/* Row 1: Consistency + info */}
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: badgeColor }]}>
          <ThemedText style={[styles.badgeText, { color: Colors[scheme].statusText }]}>
            {insights.consistency}
          </ThemedText>
        </View>
        <ThemedText style={[styles.stdDev, { color: colors.secondaryText }]}>
          ±{insights.stdDev} FPTS/game
        </ThemedText>
        <TouchableOpacity
          onPress={() =>
            Alert.alert(
              "Player Insights",
              "Consistency — How predictable this player's scoring is:\n" +
                "• Rock Solid: Very consistent output\n" +
                "• Steady: Reliable most nights\n" +
                "• Variable: Notable swings\n" +
                "• Boom or Bust: Huge range\n\n" +
                "± FPTS/game — Standard deviation. Lower = more consistent.\n\n" +
                "Range Bar — Full scoring range (low to high). Shaded area is 25th–75th percentile. Marker is season average.\n\n" +
                "Floor / Ceiling — 25th and 75th percentile scoring.\n\n" +
                "Last X — Recent average. Tap to change the window.\n\n" +
                "Trend — Recent avg vs season avg relative to variability.\n\n" +
                "Minutes — Playing time trend over the recent window.\n\n" +
                "Home / Away — Average FPTS by venue.\n\n" +
                "Back-to-Back — Performance on 2nd game of B2Bs.\n\n" +
                "Bounce-Back — Recovery rate after bad games.",
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Player insights info"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.secondaryText} />
        </TouchableOpacity>
      </View>

      {/* Row 2: Range bar with low/floor/ceiling/high markers above the line */}
      <View
        style={styles.rangeSection}
        accessibilityLabel={`Range: low ${insights.low} to high ${insights.high}. Floor ${insights.floor}, ceiling ${insights.ceiling}`}
      >
        <View style={[styles.rangeTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.iqrFill,
              {
                left: `${floorPct}%`,
                width: `${ceilPct - floorPct}%`,
                backgroundColor: badgeColor,
                opacity: 0.25,
              },
            ]}
          />
          {/* Low marker (0%) */}
          <View style={[styles.rangeMarkerWrap, { left: "0%" }]}>
            <ThemedText style={[styles.rangeMarkerValue, { color: colors.secondaryText }]}>
              {insights.low}
            </ThemedText>
            <View style={[styles.rangeMarkerLine, { backgroundColor: colors.secondaryText, opacity: 0.4 }]} />
            <ThemedText style={[styles.rangeMarkerLabel, { color: colors.secondaryText }]}>
              Low
            </ThemedText>
          </View>
          {/* Floor marker */}
          <View style={[styles.rangeMarkerWrap, { left: `${floorPct}%` }]}>
            <ThemedText style={[styles.rangeMarkerValue, { color: colors.secondaryText }]}>
              {insights.floor}
            </ThemedText>
            <View style={[styles.rangeMarkerLine, { backgroundColor: colors.secondaryText, opacity: 0.4 }]} />
            <ThemedText style={[styles.rangeMarkerLabel, { color: colors.secondaryText }]}>
              Floor
            </ThemedText>
          </View>
          {/* Ceiling marker */}
          <View style={[styles.rangeMarkerWrap, { left: `${ceilPct}%` }]}>
            <ThemedText style={[styles.rangeMarkerValue, { color: colors.secondaryText }]}>
              {insights.ceiling}
            </ThemedText>
            <View style={[styles.rangeMarkerLine, { backgroundColor: colors.secondaryText, opacity: 0.4 }]} />
            <ThemedText style={[styles.rangeMarkerLabel, { color: colors.secondaryText }]}>
              Ceiling
            </ThemedText>
          </View>
          {/* High marker (100%) */}
          <View style={[styles.rangeMarkerWrap, { left: "100%" }]}>
            <ThemedText style={[styles.rangeMarkerValue, { color: colors.secondaryText }]}>
              {insights.high}
            </ThemedText>
            <View style={[styles.rangeMarkerLine, { backgroundColor: colors.secondaryText, opacity: 0.4 }]} />
            <ThemedText style={[styles.rangeMarkerLabel, { color: colors.secondaryText }]}>
              High
            </ThemedText>
          </View>
          {/* Season avg marker */}
          <View
            style={[
              styles.avgMarker,
              { left: `${avgPct}%`, backgroundColor: colors.accent },
            ]}
          />
        </View>
      </View>

      {/* Divider */}
      <View style={styles.sectionDivider} />

      {/* Row 3: Last X (tappable dropdown) + Minutes + Trend label */}
      <View style={styles.trendRow}>
        <View style={styles.trendCell}>
          <TouchableOpacity
            onPress={() => setShowWindowPicker((v) => !v)}
            style={styles.stat}
            accessibilityRole="button"
            accessibilityLabel={`Last ${recentWindow} games average: ${insights.recentAvg} fantasy points. Tap to change window.`}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: s(2) }}>
              <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                Last {recentWindow}
              </ThemedText>
              <ThemedText style={[styles.dropdownArrow, { color: colors.secondaryText }]}>
                ▾
              </ThemedText>
            </View>
            <ThemedText style={[styles.statValue, trendCfg.color ? { color: trendCfg.color } : undefined]}>
              {insights.recentAvg}
            </ThemedText>
          </TouchableOpacity>
          {showWindowPicker && (
            <>
              <TouchableOpacity
                style={styles.windowDropdownBackdrop}
                activeOpacity={1}
                onPress={() => setShowWindowPicker(false)}
                accessibilityLabel="Close window picker"
              />
              <View
                style={[styles.windowDropdown, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {[5, 10, 15, 25, 50].map((w) => (
                  <TouchableOpacity
                    key={w}
                    onPress={() => {
                      onRecentWindowChange(w);
                      setShowWindowPicker(false);
                    }}
                    style={[
                      styles.windowDropdownItem,
                      w === recentWindow && { backgroundColor: colors.accent },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: w === recentWindow }}
                    accessibilityLabel={`Last ${w} games`}
                  >
                    <ThemedText
                      style={[
                        styles.windowDropdownText,
                        { color: colors.secondaryText },
                        w === recentWindow && { color: Colors[scheme].statusText },
                      ]}
                    >
                      {w}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
        <View
          style={styles.trendCell}
          accessibilityLabel={`Minutes ${minTrendCfg.label}, ${insights.minutesDelta > 0 ? "up" : "down"} ${Math.abs(insights.minutesDelta)} minutes`}
        >
          <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
            Minutes
          </ThemedText>
          <View style={styles.minutesTrendRow}>
            <ThemedText style={[styles.trendIcon, { color: minTrendCfg.color }]}>
              {minTrendCfg.icon}
            </ThemedText>
            <ThemedText style={[styles.statValueSmall, { color: minTrendCfg.color }]}>
              {insights.minutesDelta > 0 ? "+" : ""}{insights.minutesDelta}
            </ThemedText>
          </View>
        </View>
        <View style={styles.trendCell} accessibilityLabel={`Trend: ${trendCfg.label}`}>
          <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
            Trend
          </ThemedText>
          <View style={styles.trendBox}>
            <ThemedText style={[styles.trendIcon, { color: trendCfg.color }]}>
              {trendCfg.icon}
            </ThemedText>
            <ThemedText style={[styles.trendLabel, { color: trendCfg.color }]}>
              {trendCfg.label}
            </ThemedText>
          </View>
        </View>
      </View>

      {/* Expandable extras (season-long splits) */}
      {hasExtras && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.expandToggle}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Hide detailed insights" : "Show detailed insights"}
        >
          <ThemedText style={[styles.expandText, { color: colors.accent }]}>
            {expanded ? "Less" : "More"}
          </ThemedText>
          <ThemedText style={[styles.expandArrow, { color: colors.accent }]}>
            {expanded ? "▲" : "▼"}
          </ThemedText>
        </Pressable>
      )}

      {expanded && (
        <>
          {(homeSplit || b2b) && (
            <View style={styles.splitsRow}>
              {homeSplit && <HomeSplitCell split={homeSplit} colors={colors} />}
              {b2b && <B2BCell b2b={b2b} colors={colors} />}
            </View>
          )}
          {bounceBack && (
            <View style={styles.bounceRow}>
              <BounceBackCell bb={bounceBack} colors={colors} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

function StatCell({
  label,
  value,
  valueColor,
  secondaryText,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  valueColor?: string;
  secondaryText: string;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.stat} accessibilityLabel={accessibilityLabel}>
      <ThemedText style={[styles.statLabel, { color: secondaryText }]}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.statValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </ThemedText>
    </View>
  );
}

function HomeSplitCell({
  split,
  colors,
}: {
  split: SplitComparison;
  colors: Props["colors"];
}) {
  const scheme = useColorScheme() ?? "light";
  const delta = split.homeAvg - split.awayAvg;
  const betterAt = delta > 1 ? "home" : delta < -1 ? "away" : null;
  const highlightStyle = { color: Colors[scheme].success };
  return (
    <View
      style={styles.splitCard}
      accessibilityLabel={`Home average: ${split.homeAvg} in ${split.homeGames} games. Away average: ${split.awayAvg} in ${split.awayGames} games`}
    >
      <ThemedText style={[styles.miniLabel, { color: colors.secondaryText }]}>
        Home / Away
      </ThemedText>
      <View style={styles.splitValues}>
        <ThemedText style={[styles.splitValue, betterAt === "home" && highlightStyle]}>
          {split.homeAvg}
        </ThemedText>
        <ThemedText style={[styles.splitDivider, { color: colors.secondaryText }]}>
          /
        </ThemedText>
        <ThemedText style={[styles.splitValue, betterAt === "away" && highlightStyle]}>
          {split.awayAvg}
        </ThemedText>
      </View>
      <ThemedText style={[styles.splitSub, { color: colors.secondaryText }]}>
        {split.homeGames}G / {split.awayGames}G
      </ThemedText>
    </View>
  );
}

function B2BCell({ b2b, colors }: { b2b: B2BInsight; colors: Props["colors"] }) {
  const scheme = useColorScheme() ?? "light";
  const deltaPct =
    b2b.restAvg > 0
      ? Math.round(((b2b.b2bAvg - b2b.restAvg) / b2b.restAvg) * 100)
      : 0;
  const deltaColor = deltaPct >= 0 ? Colors[scheme].success : Colors[scheme].danger;

  return (
    <View
      style={styles.splitCard}
      accessibilityLabel={`Back to back average: ${b2b.b2bAvg} in ${b2b.b2bGames} games versus rest average: ${b2b.restAvg}. Sat out ${b2b.b2bSatOut} of ${b2b.totalB2Bs} back to backs`}
    >
      <ThemedText style={[styles.miniLabel, { color: colors.secondaryText }]}>
        Back-to-Back
      </ThemedText>
      <View style={styles.splitValues}>
        <ThemedText style={styles.splitValue}>{b2b.b2bAvg}</ThemedText>
        {deltaPct !== 0 && (
          <ThemedText style={[styles.splitDelta, { color: deltaColor }]}>
            {deltaPct > 0 ? "+" : ""}{deltaPct}%
          </ThemedText>
        )}
      </View>
      <ThemedText style={[styles.splitSub, { color: colors.secondaryText }]}>
        {b2b.b2bGames}G played{b2b.b2bSatOut > 0 ? ` · ${b2b.b2bSatOut} DNP` : ""}
      </ThemedText>
    </View>
  );
}

function CategoryStrengthRow({
  cat,
  colors,
}: {
  cat: CategoryInsight;
  colors: Props["colors"];
}) {
  const scheme = useColorScheme() ?? "light";
  const badgeColor = CONSISTENCY_COLORS[cat.consistency];
  return (
    <View
      style={styles.catRow}
      accessibilityLabel={`${cat.stat_name}: ${formatCatValue(cat.stat_name, cat.seasonAvg)} per game, ${cat.consistency}`}
    >
      <View style={styles.catStatNameWrap}>
        <ThemedText style={styles.catStatName}>{cat.stat_name}</ThemedText>
        {cat.inverse && (
          <ThemedText style={[styles.catInverse, { color: colors.secondaryText }]}>
            ↓
          </ThemedText>
        )}
      </View>
      <ThemedText style={styles.catAvgValue}>
        {formatCatValue(cat.stat_name, cat.seasonAvg)}
      </ThemedText>
      <View style={[styles.catBadge, { backgroundColor: badgeColor }]}>
        <ThemedText style={[styles.catBadgeText, { color: Colors[scheme].statusText }]}>{cat.consistency}</ThemedText>
      </View>
    </View>
  );
}

function CategoryTrendRow({
  cat,
  recentWindow,
  colors,
}: {
  cat: CategoryInsight;
  recentWindow: number;
  colors: Props["colors"];
}) {
  const scheme = useColorScheme() ?? "light";
  const trendCfg = TREND_CONFIG[cat.trend];
  // For inverse stats, flip trend color: down = good (green), up = bad (red)
  const isUp = cat.trend === "scorching" || cat.trend === "hot";
  const isDown = cat.trend === "frigid" || cat.trend === "cold";
  const trendColor =
    cat.inverse && (isUp || isDown)
      ? isUp
        ? Colors[scheme].danger
        : Colors[scheme].success
      : trendCfg.color;

  return (
    <View
      style={styles.catRow}
      accessibilityLabel={`${cat.stat_name}: ${trendCfg.label}, ${cat.trendDelta > 0 ? "up" : "down"} ${Math.abs(cat.trendDelta)} over last ${recentWindow} games`}
    >
      <View style={styles.catStatNameWrap}>
        <ThemedText style={styles.catStatName}>{cat.stat_name}</ThemedText>
        {cat.inverse && (
          <ThemedText style={[styles.catInverse, { color: colors.secondaryText }]}>
            ↓
          </ThemedText>
        )}
      </View>
      <View style={styles.catTrendInfo}>
        <View style={styles.trendBox}>
          <ThemedText style={[styles.trendIcon, { color: trendColor }]}>
            {trendCfg.icon}
          </ThemedText>
          <ThemedText style={[styles.trendLabel, { color: trendColor }]}>
            {trendCfg.label}
          </ThemedText>
        </View>
        <ThemedText style={[styles.catDelta, { color: trendColor }]}>
          {cat.trendDelta > 0 ? "+" : ""}
          {formatCatValue(cat.stat_name, cat.trendDelta)}
        </ThemedText>
      </View>
    </View>
  );
}

function BounceBackCell({ bb, colors }: { bb: BounceBack; colors: Props["colors"] }) {
  const scheme = useColorScheme() ?? "light";
  const rateColor = bb.rate >= 60 ? Colors[scheme].success : bb.rate >= 40 ? Colors[scheme].warning : Colors[scheme].danger;
  return (
    <View
      style={styles.bounceCard}
      accessibilityLabel={`Bounce back rate: ${bb.rate} percent. Bounced back ${bb.bounced} of ${bb.badGames} bad games`}
    >
      <ThemedText style={[styles.miniLabel, { color: colors.secondaryText }]}>
        Bounce-Back Rate
      </ThemedText>
      <View style={styles.bounceValues}>
        <ThemedText style={[styles.bounceRate, { color: rateColor }]}>
          {bb.rate}%
        </ThemedText>
        <ThemedText style={[styles.bounceSub, { color: colors.secondaryText }]}>
          Recovered {bb.bounced} of {bb.badGames} bad games
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: s(16),
    marginTop: s(10),
    marginBottom: s(4),
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginBottom: s(6),
  },
  badge: {
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 10,
  },
  badgeText: {
    fontSize: ms(11),
    fontWeight: "700",
  },
  stdDev: {
    fontSize: ms(12),
    flex: 1,
  },
  trendBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
  },
  trendIcon: {
    fontSize: ms(10),
    fontWeight: "700",
  },
  trendLabel: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  rangeSection: {
    marginBottom: s(10),
  },
  rangeTrack: {
    height: s(6),
    borderRadius: 3,
    marginTop: s(18),
    marginBottom: s(14),
    overflow: "visible",
    position: "relative",
  },
  iqrFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
  avgMarker: {
    position: "absolute",
    top: s(-2),
    width: s(4),
    height: s(10),
    borderRadius: 2,
    marginLeft: s(-2),
  },
  rangeMarkerWrap: {
    position: "absolute",
    alignItems: "center",
    top: s(-18),
    marginLeft: s(-18),
    width: s(36),
  },
  rangeMarkerValue: {
    fontSize: ms(9),
    fontWeight: "600",
    marginBottom: s(4),
  },
  rangeMarkerLine: {
    width: 1,
    height: s(8),
  },
  rangeMarkerLabel: {
    fontSize: ms(8),
    marginTop: 1,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(128,128,128,0.25)",
    marginTop: s(2),
    marginBottom: s(10),
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: s(4),
  },
  trendCell: {
    flex: 1,
    alignItems: "center",
  },
  dropdownArrow: {
    fontSize: ms(12),
    fontWeight: "700",
    marginTop: -1,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: s(10),
  },
  stat: {
    alignItems: "center",
  },
  statLabel: {
    fontSize: ms(10),
    marginBottom: s(2),
  },
  statValue: {
    fontSize: ms(14),
    fontWeight: "700",
  },
  statValueSmall: {
    fontSize: ms(12),
    fontWeight: "700",
  },
  minutesTrendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(2),
  },
  expandToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    paddingVertical: s(4),
    marginBottom: s(6),
  },
  expandText: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  expandArrow: {
    fontSize: ms(9),
  },
  miniLabel: {
    fontSize: ms(10),
    fontWeight: "600",
    marginBottom: s(4),
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Splits (home/away, B2B)
  splitsRow: {
    flexDirection: "row",
    gap: s(12),
    marginBottom: s(10),
  },
  splitCard: {
    flex: 1,
  },
  splitValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(4),
  },
  splitValue: {
    fontSize: ms(14),
    fontWeight: "700",
  },
  splitDivider: {
    fontSize: ms(12),
  },
  splitDelta: {
    fontSize: ms(11),
    fontWeight: "600",
  },
  splitSub: {
    fontSize: ms(10),
    marginTop: 1,
  },
  // Bounce-back
  bounceRow: {
    marginBottom: s(4),
  },
  bounceCard: {},
  bounceValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(6),
  },
  bounceRate: {
    fontSize: ms(14),
    fontWeight: "700",
  },
  bounceSub: {
    fontSize: ms(11),
  },
  // CAT insights
  catTabBar: {
    flexDirection: "row",
    marginBottom: s(12),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  catTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: s(6),
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  catTabText: {
    fontSize: ms(13),
    fontWeight: "600",
  },
  catContent: {
    gap: s(8),
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  catStatNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    width: s(48),
    gap: s(2),
  },
  catStatName: {
    fontSize: ms(12),
    fontWeight: "700",
  },
  catInverse: {
    fontSize: ms(10),
  },
  catAvgValue: {
    fontSize: ms(14),
    fontWeight: "700",
    width: s(50),
    textAlign: "right",
  },
  catBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 8,
    marginLeft: "auto",
  },
  catBadgeText: {
    fontSize: ms(10),
    fontWeight: "700",
  },
  catTrendInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  catDelta: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  // CAT trends sub-header
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: s(8),
  },
  recentTitle: {
    fontSize: ms(12),
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Window picker
  windowPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 10,
    borderWidth: 1,
  },
  windowPickerLabel: {
    fontSize: ms(11),
    fontWeight: "600",
  },
  windowDropdownBackdrop: {
    position: "absolute",
    top: 0,
    left: s(-1000),
    right: s(-1000),
    bottom: s(-1000),
    zIndex: 9,
  },
  windowDropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: s(4),
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: s(4),
    zIndex: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    minWidth: s(52),
  },
  windowDropdownItem: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    alignItems: "center",
  },
  windowDropdownText: {
    fontSize: ms(13),
    fontWeight: "600",
  },
});
