import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from "@/types/player";
import { CategoryDef } from "@/utils/categoryScoring";
import { calculateGameFantasyPoints } from "@/utils/fantasyPoints";

export type ConsistencyLabel =
  | "Rock Solid"
  | "Steady"
  | "Variable"
  | "Boom or Bust";
export type TrendDirection =
  | "scorching"
  | "hot"
  | "neutral"
  | "cold"
  | "frigid";

export interface PlayerInsights {
  consistency: ConsistencyLabel;
  stdDev: number;
  recentAvg: number;
  trend: TrendDirection;
  trendPct: number;
  high: number;
  low: number;
  floor: number; // 25th percentile
  ceiling: number; // 75th percentile
  gamesUsed: number; // how many games passed filters
  minutesTrend: TrendDirection;
  minutesDelta: number; // recent avg min - season avg min
}

export interface StatBreakdown {
  stat: string;
  pct: number;
  fpts: number;
}

export interface SplitComparison {
  homeAvg: number;
  awayAvg: number;
  homeGames: number;
  awayGames: number;
}

export interface B2BInsight {
  b2bAvg: number;
  restAvg: number;
  b2bGames: number;
  restGames: number;
  b2bSatOut: number;
  totalB2Bs: number;
}

export interface BounceBack {
  rate: number;
  bounced: number;
  badGames: number;
}

/**
 * Computes scoring variability insights from a player's game log.
 * Uses the canonical seasonAvg (from season totals) for trend comparison
 * so numbers stay consistent with the Season Averages section.
 * Returns null if fewer than 5 games played.
 */
export function calculatePlayerInsights(
  games: PlayerGameLog[],
  scoringWeights: ScoringWeight[],
  seasonAvg: number,
  recentWindow: number = 10,
): PlayerInsights | null {
  // Filter out DNP and early-exit games (injured out early, etc.)
  // Exclude games where minutes < 20% of the player's average
  const nonZero = games.filter((g) => g.min > 0);
  if (nonZero.length < 5) return null;
  const avgMin = nonZero.reduce((s, g) => s + g.min, 0) / nonZero.length;
  const minThreshold = avgMin * 0.2;
  const played = nonZero.filter((g) => g.min >= minThreshold);
  if (played.length < 5) return null;

  const scores = played.map((g) =>
    calculateGameFantasyPoints(g, scoringWeights),
  );

  // Standard deviation (use seasonAvg as the mean for consistency)
  const variance =
    scores.reduce((acc, s) => acc + (s - seasonAvg) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation → consistency label
  const cv = seasonAvg !== 0 ? stdDev / Math.abs(seasonAvg) : 1;
  let consistency: ConsistencyLabel;
  if (cv < 0.3) consistency = "Rock Solid";
  else if (cv < 0.4) consistency = "Steady";
  else if (cv < 0.5) consistency = "Variable";
  else consistency = "Boom or Bust";

  // Recent window vs season avg trend (scaled by stdDev so it's relative to the player's own variance)
  const recentScores = scores.slice(0, Math.min(recentWindow, scores.length));
  const recentAvg =
    recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  const trendPct =
    seasonAvg !== 0 ? ((recentAvg - seasonAvg) / Math.abs(seasonAvg)) * 100 : 0;
  const drift = stdDev > 0 ? (recentAvg - seasonAvg) / stdDev : 0;
  let trend: TrendDirection = "neutral";
  if (drift > 0.6) trend = "scorching";
  else if (drift > 0.3) trend = "hot";
  else if (drift < -0.6) trend = "frigid";
  else if (drift < -0.3) trend = "cold";

  // Minutes trend (same drift approach as scoring trend)
  const recentMins = played.slice(0, Math.min(recentWindow, played.length));
  const recentAvgMin = recentMins.reduce((s, g) => s + g.min, 0) / recentMins.length;
  const minStdDev = Math.sqrt(
    played.reduce((acc, g) => acc + (g.min - avgMin) ** 2, 0) / played.length,
  );
  const minDrift = minStdDev > 0 ? (recentAvgMin - avgMin) / minStdDev : 0;
  let minutesTrend: TrendDirection = "neutral";
  if (minDrift > 0.6) minutesTrend = "scorching";
  else if (minDrift > 0.3) minutesTrend = "hot";
  else if (minDrift < -0.6) minutesTrend = "frigid";
  else if (minDrift < -0.3) minutesTrend = "cold";

  // Percentiles (sorted ascending)
  const sorted = [...scores].sort((a, b) => a - b);
  const p25Idx = Math.floor(sorted.length * 0.25);
  const p75Idx = Math.floor(sorted.length * 0.75);

  return {
    consistency,
    stdDev: round1(stdDev),
    recentAvg: round1(recentAvg),
    trend,
    trendPct: round1(trendPct),
    high: round1(sorted[sorted.length - 1]),
    low: round1(sorted[0]),
    floor: round1(sorted[p25Idx]),
    ceiling: round1(sorted[p75Idx]),
    gamesUsed: scores.length,
    minutesTrend,
    minutesDelta: round1(recentAvgMin - avgMin),
  };
}

// Maps stat_name to PlayerSeasonStats total column
const STAT_TO_TOTAL: Record<string, keyof PlayerSeasonStats> = {
  PTS: "total_pts",
  REB: "total_reb",
  AST: "total_ast",
  STL: "total_stl",
  BLK: "total_blk",
  TO: "total_tov",
  "3PM": "total_3pm",
  "3PA": "total_3pa",
  FGM: "total_fgm",
  FGA: "total_fga",
  FTM: "total_ftm",
  FTA: "total_fta",
  PF: "total_pf",
  DD: "total_dd",
  TD: "total_td",
};

/**
 * Breaks down what % of a player's FPTS comes from each scoring category.
 * Uses season totals for accuracy. Returns categories sorted by contribution (highest first).
 */
export function calculateStatBreakdown(
  player: PlayerSeasonStats,
  weights: ScoringWeight[],
): StatBreakdown[] {
  if (player.games_played === 0) return [];

  const items: StatBreakdown[] = [];
  let totalFpts = 0;

  for (const w of weights) {
    const field = STAT_TO_TOTAL[w.stat_name];
    if (!field) continue;
    const statTotal = player[field] as number;
    const fpts = (statTotal * w.point_value) / player.games_played;
    totalFpts += fpts;
    items.push({ stat: w.stat_name, pct: 0, fpts: round1(fpts) });
  }

  if (totalFpts === 0) return [];

  for (const item of items) {
    item.pct = round1((item.fpts / totalFpts) * 100);
  }

  return items
    .filter((i) => i.pct !== 0)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

/**
 * Compares home vs away FPTS averages.
 * Returns null if fewer than 3 games in either bucket.
 */
export function calculateHomeSplit(
  games: PlayerGameLog[],
  weights: ScoringWeight[],
): SplitComparison | null {
  const home: number[] = [];
  const away: number[] = [];

  for (const g of games) {
    if (g.min <= 0 || !g.matchup) continue;
    const fpts = calculateGameFantasyPoints(g, weights);
    if (g.matchup.includes("@")) {
      away.push(fpts);
    } else {
      home.push(fpts);
    }
  }

  if (home.length < 3 || away.length < 3) return null;

  return {
    homeAvg: round1(home.reduce((a, b) => a + b, 0) / home.length),
    awayAvg: round1(away.reduce((a, b) => a + b, 0) / away.length),
    homeGames: home.length,
    awayGames: away.length,
  };
}

/**
 * Detects back-to-back games and compares performance.
 * A B2B is when game_date is exactly 1 day after the previous game.
 * Returns null if fewer than 3 B2B games played.
 */
export function calculateB2BImpact(
  games: PlayerGameLog[],
  weights: ScoringWeight[],
): B2BInsight | null {
  const withDates = games
    .filter((g) => g.game_date)
    .sort((a, b) => a.game_date!.localeCompare(b.game_date!));

  if (withDates.length < 2) return null;

  const b2bScores: number[] = [];
  const restScores: number[] = [];
  let b2bSatOut = 0;
  let totalB2Bs = 0;

  for (let i = 1; i < withDates.length; i++) {
    const prev = new Date(withDates[i - 1].game_date!);
    const curr = new Date(withDates[i].game_date!);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      totalB2Bs++;
      if (withDates[i].min <= 0) {
        b2bSatOut++;
      } else {
        b2bScores.push(calculateGameFantasyPoints(withDates[i], weights));
      }
    } else if (withDates[i].min > 0) {
      restScores.push(calculateGameFantasyPoints(withDates[i], weights));
    }
  }

  if (b2bScores.length < 2 && totalB2Bs < 2) return null;

  return {
    b2bAvg: b2bScores.length > 0
      ? round1(b2bScores.reduce((a, b) => a + b, 0) / b2bScores.length)
      : 0,
    restAvg: restScores.length > 0
      ? round1(restScores.reduce((a, b) => a + b, 0) / restScores.length)
      : 0,
    b2bGames: b2bScores.length,
    restGames: restScores.length,
    b2bSatOut,
    totalB2Bs,
  };
}

/**
 * After a below-floor game (< 25th percentile), how often does the player
 * bounce back to at or above their season average in the next game?
 * Returns null if fewer than 3 bad games to evaluate.
 */
export function calculateBounceBack(
  games: PlayerGameLog[],
  weights: ScoringWeight[],
  seasonAvg: number,
): BounceBack | null {
  const played = games.filter((g) => g.min > 0);
  if (played.length < 5) return null;

  const scores = played.map((g) => calculateGameFantasyPoints(g, weights));
  const sorted = [...scores].sort((a, b) => a - b);
  const floorVal = sorted[Math.floor(sorted.length * 0.25)];

  let badGames = 0;
  let bounced = 0;

  // Games are ordered most recent first — iterate pairs
  for (let i = 0; i < scores.length - 1; i++) {
    if (scores[i + 1] < floorVal) {
      badGames++;
      if (scores[i] >= seasonAvg) {
        bounced++;
      }
    }
  }

  if (badGames < 3) return null;

  return {
    rate: round1((bounced / badGames) * 100),
    bounced,
    badGames,
  };
}

/* ── Category (H2H) Insights ─────────────────────────────── */

// Maps stat_name to player_games column (same as categoryScoring.ts STAT_TO_GAME_KEY)
const CAT_STAT_TO_GAME: Record<string, string> = {
  PTS: "pts",
  REB: "reb",
  AST: "ast",
  STL: "stl",
  BLK: "blk",
  TO: "tov",
  "3PM": "3pm",
  "3PA": "3pa",
  FGM: "fgm",
  FGA: "fga",
  FTM: "ftm",
  FTA: "fta",
  PF: "pf",
  DD: "double_double",
  TD: "triple_double",
};

const PERCENTAGE_CATS: Record<string, { num: string; den: string }> = {
  "FG%": { num: "fgm", den: "fga" },
  "FT%": { num: "ftm", den: "fta" },
};

export interface CategoryInsight {
  stat_name: string;
  inverse: boolean;
  seasonAvg: number;
  recentAvg: number;
  stdDev: number;
  consistency: ConsistencyLabel;
  trend: TrendDirection;
  trendDelta: number;
}

export interface CategoryInsightsResult {
  categories: CategoryInsight[];
  minutesTrend: TrendDirection;
  minutesDelta: number;
  gamesUsed: number;
}

/**
 * Computes per-category consistency and trend insights for H2H category leagues.
 * Returns null if fewer than 5 qualifying games.
 */
export function calculateCategoryInsights(
  games: PlayerGameLog[],
  categories: CategoryDef[],
  recentWindow: number = 10,
): CategoryInsightsResult | null {
  const nonZero = games.filter((g) => g.min > 0);
  if (nonZero.length < 5) return null;
  const avgMin = nonZero.reduce((s, g) => s + g.min, 0) / nonZero.length;
  const minThreshold = avgMin * 0.2;
  const played = nonZero.filter((g) => g.min >= minThreshold);
  if (played.length < 5) return null;

  const results: CategoryInsight[] = [];

  for (const cat of categories) {
    const pctDef = PERCENTAGE_CATS[cat.stat_name];
    let values: number[];

    if (pctDef) {
      // Percentage stat: compute per-game % from made/attempted
      values = played.map((g) => {
        const num = (g as any)[pctDef.num] ?? 0;
        const den = (g as any)[pctDef.den] ?? 0;
        return den > 0 ? round1((num / den) * 100) : 0;
      });
    } else {
      const gameKey = CAT_STAT_TO_GAME[cat.stat_name];
      if (!gameKey) continue;
      values = played.map((g) => {
        const raw = (g as any)[gameKey];
        if (raw == null) return 0;
        return typeof raw === "boolean" ? (raw ? 1 : 0) : (raw as number);
      });
    }

    const seasonAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((acc, v) => acc + (v - seasonAvg) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    const cv = seasonAvg !== 0 ? stdDev / Math.abs(seasonAvg) : 1;
    let consistency: ConsistencyLabel;
    if (cv < 0.3) consistency = "Rock Solid";
    else if (cv < 0.4) consistency = "Steady";
    else if (cv < 0.5) consistency = "Variable";
    else consistency = "Boom or Bust";

    const recentValues = values.slice(0, Math.min(recentWindow, values.length));
    const recentAvg =
      recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const drift = stdDev > 0 ? (recentAvg - seasonAvg) / stdDev : 0;
    let trend: TrendDirection = "neutral";
    if (drift > 0.6) trend = "scorching";
    else if (drift > 0.3) trend = "hot";
    else if (drift < -0.6) trend = "frigid";
    else if (drift < -0.3) trend = "cold";

    results.push({
      stat_name: cat.stat_name,
      inverse: cat.inverse,
      seasonAvg: round1(seasonAvg),
      recentAvg: round1(recentAvg),
      stdDev: round1(stdDev),
      consistency,
      trend,
      trendDelta: round1(recentAvg - seasonAvg),
    });
  }

  // Minutes trend (same as points insights)
  const recentMins = played.slice(0, Math.min(recentWindow, played.length));
  const recentAvgMin =
    recentMins.reduce((s, g) => s + g.min, 0) / recentMins.length;
  const minStdDev = Math.sqrt(
    played.reduce((acc, g) => acc + (g.min - avgMin) ** 2, 0) / played.length,
  );
  const minDrift = minStdDev > 0 ? (recentAvgMin - avgMin) / minStdDev : 0;
  let minutesTrend: TrendDirection = "neutral";
  if (minDrift > 0.6) minutesTrend = "scorching";
  else if (minDrift > 0.3) minutesTrend = "hot";
  else if (minDrift < -0.6) minutesTrend = "frigid";
  else if (minDrift < -0.3) minutesTrend = "cold";

  return {
    categories: results,
    minutesTrend,
    minutesDelta: round1(recentAvgMin - avgMin),
    gamesUsed: played.length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
