import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TouchableOpacity, View } from "react-native";

import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { InfoModal } from "@/components/ui/InfoModal";
import { Section } from "@/components/ui/Section";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors, Fonts, cardShadow } from "@/constants/Colors";
import { TREND_COLORS } from "@/constants/StatusColors";
import { useColors } from "@/hooks/useColors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerGameLog, ScoringWeight } from "@/types/player";
import { ms, s } from "@/utils/scale";
import {
  calculateCategoryInsights,
  calculatePlayerInsights,
  CategoryInsight,
  ConsistencyLabel,
} from "@/utils/scoring/playerInsights";
import { TREND_CONFIG } from "@/utils/scoring/trendDisplay";

const CONSISTENCY_VARIANT: Record<ConsistencyLabel, BadgeVariant> = {
  "Rock Solid": "turf",
  Steady: "gold",
  Variable: "warning",
  "Boom or Bust": "merlot",
};

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

  // CAT insights
  const catInsights = useMemo(() => {
    if (!isCategories || !games || !categories) return null;
    return calculateCategoryInsights(games, categories, recentWindow);
  }, [isCategories, games, categories, recentWindow]);

  const scheme = useColorScheme() ?? "light";
  const theme = useColors();

  const [catTab, setCatTab] = useState<"strengths" | "trends">("strengths");
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [infoKey, setInfoKey] = useState<"category" | "player" | null>(null);

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
      <Section noCard title="INSIGHTS">
        <View
          style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
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
            onPress={() => setInfoKey("category")}
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

        <InfoModal
          visible={infoKey === "category"}
          onClose={() => setInfoKey(null)}
          title="Category Insights"
          message={
            "Strengths — Per-category consistency, sorted by reliability:\n" +
            "• Rock Solid: Very consistent output\n" +
            "• Steady: Reliable most nights\n" +
            "• Variable: Notable swings\n" +
            "• Boom or Bust: Huge range\n\n" +
            "↓ — Inverse stat (lower is better, e.g. turnovers).\n\n" +
            "Trends — How each category is trending recently vs season average.\n\n" +
            "For inverse stats, trend colors are flipped — a downward trend shows green.\n\n" +
            "Tap the filter icon to change the recent games window."
          }
        />
        </View>
      </Section>
    );
  }

  // --- Points league branch (existing) ---
  if (!insights) return null;

  // Box-and-whisker percentages on the low→high scale.
  const range = insights.high - insights.low;
  const avgPct =
    range > 0
      ? Math.min(100, Math.max(0, ((seasonAvg! - insights.low) / range) * 100))
      : 50;
  const floorPct =
    range > 0 ? ((insights.floor - insights.low) / range) * 100 : 25;
  const ceilPct =
    range > 0 ? ((insights.ceiling - insights.low) / range) * 100 : 75;

  const avgRounded = Math.round(seasonAvg! * 10) / 10;
  return (
    <>
      {/* SCORING RANGE — season-long distribution: how volatile, and the spread. */}
      <Section noCard title="SCORING RANGE">
        <View
          style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityLabel={`Scoring range: ${insights.consistency}, low ${insights.low}, average ${avgRounded}, high ${insights.high}`}
          accessibilityRole="summary"
        >
          <View style={styles.topRow}>
            <Badge
              label={insights.consistency}
              variant={CONSISTENCY_VARIANT[insights.consistency]}
            />
            <ThemedText style={[styles.stdDev, { color: colors.secondaryText }]}>
              ±{insights.stdDev} FPTS/G
            </ThemedText>
            <TouchableOpacity
              onPress={() => setInfoKey("player")}
              accessibilityRole="button"
              accessibilityLabel="Scoring range info"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="information-circle-outline" size={16} color={colors.secondaryText} />
            </TouchableOpacity>
          </View>

          {/* Box-and-whisker: whiskers to Low/High, box for Floor–Ceiling, line at avg. */}
          <View style={styles.bw}>
            <View style={[styles.bwTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.bwBox,
                  {
                    left: `${floorPct}%`,
                    width: `${Math.max(ceilPct - floorPct, 1.5)}%`,
                    backgroundColor: colors.accent,
                    borderColor: colors.accent,
                  },
                ]}
              />
              <View style={[styles.bwCap, { left: 0, backgroundColor: colors.secondaryText }]} />
              <View style={[styles.bwCap, { right: 0, backgroundColor: colors.secondaryText }]} />
              <View style={[styles.bwAvg, { left: `${avgPct}%`, backgroundColor: theme.text }]} />
            </View>
          </View>

          <View style={styles.legend}>
            {(
              [
                ["LOW", insights.low],
                ["FLOOR", insights.floor],
                ["AVG", avgRounded],
                ["CEIL", insights.ceiling],
                ["HIGH", insights.high],
              ] as const
            ).map(([label, value]) => (
              <View key={label} style={styles.legendCell}>
                <ThemedText type="varsitySmall" style={[styles.legendLabel, { color: colors.secondaryText }]}>
                  {label}
                </ThemedText>
                <ThemedText
                  type="mono"
                  style={[styles.legendValue, { color: label === "AVG" ? colors.accent : theme.text }]}
                >
                  {value}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      </Section>

      <InfoModal
        visible={infoKey === "player"}
        onClose={() => setInfoKey(null)}
        title="Scoring Range"
        message={
          "Consistency — How predictable scoring is, season-long:\n" +
          "• Rock Solid: Very consistent output\n" +
          "• Steady: Reliable most nights\n" +
          "• Variable: Notable swings\n" +
          "• Boom or Bust: Huge range\n\n" +
          "± FPTS/game — Standard deviation. Lower = more consistent.\n\n" +
          "Box plot — Whiskers reach the season Low and High; the box is the Floor–Ceiling (25th–75th percentile) typical range; the line is the season average."
        }
      />
    </>
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

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginTop: s(2),
    borderRadius: 14,
    borderWidth: 1,
    ...cardShadow,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginBottom: s(6),
  },
  stdDev: {
    fontFamily: Fonts.mono,
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
  // Box-and-whisker distribution
  bw: {
    height: s(24),
    justifyContent: "center",
    marginTop: s(14),
  },
  bwTrack: {
    height: 2,
    borderRadius: 1,
    position: "relative",
  },
  bwBox: {
    position: "absolute",
    top: s(-7),
    height: s(16),
    borderRadius: 3,
    borderWidth: 1,
    opacity: 0.32,
  },
  bwCap: {
    position: "absolute",
    top: s(-6),
    width: 2,
    height: s(14),
    borderRadius: 1,
  },
  bwAvg: {
    position: "absolute",
    top: s(-9),
    width: 3,
    height: s(20),
    borderRadius: 1.5,
    marginLeft: -1.5,
  },
  legend: {
    flexDirection: "row",
    marginTop: s(6),
    marginBottom: s(2),
  },
  legendCell: {
    flex: 1,
    alignItems: "center",
  },
  legendLabel: {
    fontSize: ms(8.5),
    letterSpacing: 0.6,
    marginBottom: s(2),
  },
  legendValue: {
    fontSize: ms(13),
  },
  // Recent-window segmented control
  windowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(8),
    marginBottom: s(12),
  },
  windowCaption: {
    fontSize: ms(9),
    letterSpacing: 0.8,
  },
  windowSeg: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  windowSegItem: {
    paddingVertical: s(5),
    paddingHorizontal: s(11),
    alignItems: "center",
    justifyContent: "center",
  },
  windowSegText: {
    fontSize: ms(10),
    letterSpacing: 0.5,
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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9.5),
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: s(2),
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
  },
  statValueSmall: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9.5),
    marginBottom: s(4),
    textTransform: "uppercase",
    letterSpacing: 0.8,
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
    fontFamily: Fonts.mono,
    fontSize: ms(15),
  },
  splitDivider: {
    fontSize: ms(12),
  },
  splitDelta: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
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
    fontFamily: Fonts.mono,
    fontSize: ms(15),
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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 0.8,
    textTransform: "uppercase",
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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 0.6,
  },
  catInverse: {
    fontSize: ms(10),
  },
  catAvgValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(14),
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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  catTrendInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  catDelta: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
  },
  // CAT trends sub-header
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: s(8),
  },
  recentTitle: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    textTransform: "uppercase",
    letterSpacing: 0.8,
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
