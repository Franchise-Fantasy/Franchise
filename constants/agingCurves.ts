import curveData from './agingCurves.json';

export type PositionCurve = 'ALL' | 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F';

/** Per-game stat averages at a given age */
export interface StatLine {
  PTS: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  TOV: number;
  FG3M: number;
  FGM: number;
  FGA: number;
  FTM: number;
  FTA: number;
  PF: number;
}

export interface TierData {
  replacementLevel: number;
  playerSeasons: number;
  /** Normalized curves (0-1 scale, peak = 1.0) — for projections */
  curves: Record<string, Record<string, number>>;
  /** Median per-game stat lines at each age — client applies scoring weights */
  statLines: Record<string, Record<string, StatLine>>;
  /** 25th percentile stat lines */
  statLinesP25: Record<string, Record<string, StatLine>>;
  /** 75th percentile stat lines */
  statLinesP75: Record<string, Record<string, StatLine>>;
  sampleSizes: Record<string, Record<string, number>>;
}

export interface AgingCurveData {
  generated: string;
  peakAge: number;
  minSeason: number;
  maxSeason: number;
  minGames: number;
  minMpg: number;
  tiers: Record<string, TierData>;
  baseline: Omit<TierData, 'replacementLevel' | 'playerSeasons'>;
  scoringWeights: Record<string, number>;
}

export const AGING_CURVES = curveData as AgingCurveData;

export const TIER_LEVELS = [60, 100, 150, 200] as const;

export const POSITION_CURVE_KEYS: PositionCurve[] = [
  'ALL', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F',
];

/**
 * Pick the best tier for a league based on total rostered players.
 */
export function getTierForLeague(teams: number, rosterSpots: number): string {
  const total = teams * rosterSpots;
  let best: number = TIER_LEVELS[0];
  for (const tier of TIER_LEVELS) {
    if (Math.abs(tier - total) < Math.abs(best - total)) best = tier;
  }
  return String(best);
}

/** Stat key to scoring weight key mapping */
const STAT_TO_SCORING: Record<string, string> = {
  PTS: 'PTS',
  REB: 'REB',
  AST: 'AST',
  STL: 'STL',
  BLK: 'BLK',
  TOV: 'TO',
  FG3M: '3PM',
  FGM: 'FGM',
  FGA: 'FGA',
  FTM: 'FTM',
  FTA: 'FTA',
  PF: 'PF',
};

/**
 * Convert a stat line to FPTS using the given scoring weights.
 * Scoring weights should be keyed by stat_name (e.g. "PTS", "TO", "3PM").
 */
export function statLineToFpts(
  statLine: StatLine,
  scoringWeights: { stat_name: string; point_value: number }[],
): number {
  const weightMap = new Map(scoringWeights.map((w) => [w.stat_name, w.point_value]));
  let total = 0;
  for (const [statKey, scoringKey] of Object.entries(STAT_TO_SCORING)) {
    const weight = weightMap.get(scoringKey) ?? 0;
    const value = (statLine as unknown as Record<string, number>)[statKey] ?? 0;
    total += value * weight;
  }
  return total;
}
