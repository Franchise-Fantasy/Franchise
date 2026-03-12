import { ThemedText } from "@/components/ThemedText";
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
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

interface Props {
  games: PlayerGameLog[] | undefined;
  scoringWeights: ScoringWeight[] | undefined;
  seasonAvg: number | null;
  recentWindow: number;
  colors: {
    border: string;
    secondaryText: string;
    accent: string;
    card: string;
  };
  scoringType?: string;
}

const CONSISTENCY_COLORS: Record<ConsistencyLabel, string> = {
  "Rock Solid": "#28a745",
  Steady: "#17a2b8",
  Variable: "#e67e22",
  "Boom or Bust": "#dc3545",
};

const TREND_CONFIG: Record<
  TrendDirection,
  { label: string; color: string; icon: string }
> = {
  scorching: { label: "Scorching", color: "#dc3545", icon: "▲▲" },
  hot: { label: "Hot", color: "#e67e22", icon: "▲" },
  neutral: { label: "Stable", color: "#6c757d", icon: "—" },
  cold: { label: "Cold", color: "#17a2b8", icon: "▼" },
  frigid: { label: "Frigid", color: "#6f42c1", icon: "▼▼" },
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

  const [expanded, setExpanded] = useState(false);
  const [catTab, setCatTab] = useState<"strengths" | "trends">("strengths");

  // --- CAT league branch ---
  if (isCategories) {
    if (!catInsights) return null;

    const strengthsSorted = [...catInsights.categories].sort((a, b) => {
      const rankDiff =
        CONSISTENCY_RANK[a.consistency] - CONSISTENCY_RANK[b.consistency];
      if (rankDiff !== 0) return rankDiff;
      return b.seasonAvg - a.seasonAvg;
    });

    const trendsSorted = [...catInsights.categories].sort(
      (a, b) => Math.abs(b.trendDelta) - Math.abs(a.trendDelta),
    );

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
      {/* Row 1: Consistency + Trend */}
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: badgeColor }]}>
          <ThemedText style={styles.badgeText}>
            {insights.consistency}
          </ThemedText>
        </View>
        <ThemedText style={[styles.stdDev, { color: colors.secondaryText }]}>
          ±{insights.stdDev} FPTS/game
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

      {/* Row 2: Range bar */}
      <View style={styles.rangeSection}>
        <View style={styles.rangeLabels}>
          <ThemedText style={[styles.rangeValue, { color: colors.secondaryText }]}>
            {insights.low}
          </ThemedText>
          <ThemedText style={[styles.rangeValue, { color: colors.secondaryText }]}>
            {insights.high}
          </ThemedText>
        </View>
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
          <View
            style={[
              styles.avgMarker,
              { left: `${avgPct}%`, backgroundColor: colors.accent },
            ]}
          />
        </View>
        <View style={styles.rangeLabels}>
          <ThemedText style={[styles.rangeCaption, { color: colors.secondaryText }]}>
            Low
          </ThemedText>
          <ThemedText style={[styles.rangeCaption, { color: colors.secondaryText }]}>
            High
          </ThemedText>
        </View>
      </View>

      {/* Row 3: Floor / Ceiling / Recent Avg / Minutes */}
      <View style={styles.statsRow}>
        <StatCell
          label="Floor"
          value={String(insights.floor)}
          secondaryText={colors.secondaryText}
          accessibilityLabel={`Floor: ${insights.floor} fantasy points`}
        />
        <StatCell
          label="Ceiling"
          value={String(insights.ceiling)}
          secondaryText={colors.secondaryText}
          accessibilityLabel={`Ceiling: ${insights.ceiling} fantasy points`}
        />
        <StatCell
          label={`Last ${recentWindow}`}
          value={String(insights.recentAvg)}
          valueColor={trendCfg.color}
          secondaryText={colors.secondaryText}
          accessibilityLabel={`Last ${recentWindow} games average: ${insights.recentAvg} fantasy points`}
        />
        <View
          style={styles.stat}
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
      </View>

      {/* Expandable extras */}
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
          {/* Home/Away + B2B */}
          {(homeSplit || b2b) && (
            <View style={styles.splitsRow}>
              {homeSplit && <HomeSplitCell split={homeSplit} colors={colors} />}
              {b2b && <B2BCell b2b={b2b} colors={colors} />}
            </View>
          )}

          {/* Bounce-back */}
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
  const delta = split.homeAvg - split.awayAvg;
  const betterAt = delta > 1 ? "home" : delta < -1 ? "away" : null;
  return (
    <View
      style={styles.splitCard}
      accessibilityLabel={`Home average: ${split.homeAvg} in ${split.homeGames} games. Away average: ${split.awayAvg} in ${split.awayGames} games`}
    >
      <ThemedText style={[styles.miniLabel, { color: colors.secondaryText }]}>
        Home / Away
      </ThemedText>
      <View style={styles.splitValues}>
        <ThemedText style={[styles.splitValue, betterAt === "home" && styles.splitHighlight]}>
          {split.homeAvg}
        </ThemedText>
        <ThemedText style={[styles.splitDivider, { color: colors.secondaryText }]}>
          /
        </ThemedText>
        <ThemedText style={[styles.splitValue, betterAt === "away" && styles.splitHighlight]}>
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
  const deltaPct =
    b2b.restAvg > 0
      ? Math.round(((b2b.b2bAvg - b2b.restAvg) / b2b.restAvg) * 100)
      : 0;
  const deltaColor = deltaPct >= 0 ? "#28a745" : "#dc3545";

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
        <ThemedText style={styles.catBadgeText}>{cat.consistency}</ThemedText>
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
  const trendCfg = TREND_CONFIG[cat.trend];
  // For inverse stats, flip trend color: down = good (green), up = bad (red)
  const isUp = cat.trend === "scorching" || cat.trend === "hot";
  const isDown = cat.trend === "frigid" || cat.trend === "cold";
  const trendColor =
    cat.inverse && (isUp || isDown)
      ? isUp
        ? "#dc3545"
        : "#28a745"
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
  const rateColor = bb.rate >= 60 ? "#28a745" : bb.rate >= 40 ? "#e67e22" : "#dc3545";
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
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  stdDev: {
    fontSize: 12,
    flex: 1,
  },
  trendBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  trendIcon: {
    fontSize: 10,
    fontWeight: "700",
  },
  trendLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  rangeSection: {
    marginBottom: 10,
  },
  rangeLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rangeValue: {
    fontSize: 11,
    fontWeight: "600",
  },
  rangeCaption: {
    fontSize: 10,
    marginTop: 2,
  },
  rangeTrack: {
    height: 8,
    borderRadius: 4,
    marginVertical: 4,
    overflow: "hidden",
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
    top: -2,
    width: 4,
    height: 12,
    borderRadius: 2,
    marginLeft: -2,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 10,
  },
  stat: {
    alignItems: "center",
  },
  statLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  statValueSmall: {
    fontSize: 12,
    fontWeight: "700",
  },
  minutesTrendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  expandToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
    marginBottom: 6,
  },
  expandText: {
    fontSize: 12,
    fontWeight: "600",
  },
  expandArrow: {
    fontSize: 9,
  },
  miniLabel: {
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Splits (home/away, B2B)
  splitsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  splitCard: {
    flex: 1,
  },
  splitValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  splitValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  splitHighlight: {
    color: "#28a745",
  },
  splitDivider: {
    fontSize: 12,
  },
  splitDelta: {
    fontSize: 11,
    fontWeight: "600",
  },
  splitSub: {
    fontSize: 10,
    marginTop: 1,
  },
  // Bounce-back
  bounceRow: {
    marginBottom: 4,
  },
  bounceCard: {},
  bounceValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  bounceRate: {
    fontSize: 14,
    fontWeight: "700",
  },
  bounceSub: {
    fontSize: 11,
  },
  // CAT insights
  catTabBar: {
    flexDirection: "row",
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  catTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  catTabText: {
    fontSize: 13,
    fontWeight: "600",
  },
  catContent: {
    gap: 8,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  catStatNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    width: 48,
    gap: 2,
  },
  catStatName: {
    fontSize: 12,
    fontWeight: "700",
  },
  catInverse: {
    fontSize: 10,
  },
  catAvgValue: {
    fontSize: 14,
    fontWeight: "700",
    width: 50,
    textAlign: "right",
  },
  catBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: "auto",
  },
  catBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  catTrendInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  catDelta: {
    fontSize: 12,
    fontWeight: "600",
  },
});
