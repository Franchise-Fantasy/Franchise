/**
 * Analytics utilities for H2H Category leagues.
 * Provides team vs league comparisons, z-score composites,
 * and age-tier breakdowns per category.
 */

import { PlayerSeasonStats } from '@/types/player';
import { calculateAge, ageBucket, shortDisplayName } from '@/utils/rosterAge';

// Canonical 9-CAT order
export const CAT_ORDER = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', '3PM', 'FG%', 'FT%'] as const;
export type CatName = (typeof CAT_ORDER)[number];

// Map stat names to player_season_stats average fields
const STAT_TO_AVG: Record<string, keyof PlayerSeasonStats> = {
  PTS: 'avg_pts',
  REB: 'avg_reb',
  AST: 'avg_ast',
  STL: 'avg_stl',
  BLK: 'avg_blk',
  TO: 'avg_tov',
  '3PM': 'avg_3pm',
};

// Percentage stats need numerator/denominator from totals
const PCT_STATS: Record<string, { num: keyof PlayerSeasonStats; den: keyof PlayerSeasonStats }> = {
  'FG%': { num: 'total_fgm', den: 'total_fga' },
  'FT%': { num: 'total_ftm', den: 'total_fta' },
};

const INVERSE_CATS = new Set(['TO']);

// ── Team Category Averages ──────────────────────────────────────────────────

export interface TeamCategoryAvg {
  teamId: string;
  averages: Record<CatName, number>;
}

/** Get the per-game average for a counting stat across a team's roster */
function teamCountingAvg(players: PlayerSeasonStats[], stat: keyof PlayerSeasonStats): number {
  let total = 0;
  for (const p of players) {
    total += (p[stat] as number) ?? 0;
  }
  return players.length > 0 ? total / players.length : 0;
}

/** Get the team's weighted percentage stat (volume-weighted, not simple average) */
function teamPctAvg(players: PlayerSeasonStats[], num: keyof PlayerSeasonStats, den: keyof PlayerSeasonStats): number {
  let totalNum = 0;
  let totalDen = 0;
  for (const p of players) {
    totalNum += (p[num] as number) ?? 0;
    totalDen += (p[den] as number) ?? 0;
  }
  return totalDen > 0 ? (totalNum / totalDen) * 100 : 0;
}

/** Compute per-category team averages (summed per-game averages for counting stats, volume-weighted for %) */
export function computeTeamCategoryAvgs(
  allPlayers: (PlayerSeasonStats & { team_id: string })[],
): TeamCategoryAvg[] {
  const byTeam = new Map<string, PlayerSeasonStats[]>();
  for (const p of allPlayers) {
    if (!p.team_id || p.games_played < 1) continue;
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id)!.push(p);
  }

  const results: TeamCategoryAvg[] = [];
  for (const [teamId, players] of byTeam) {
    const averages = {} as Record<CatName, number>;
    for (const cat of CAT_ORDER) {
      const pctDef = PCT_STATS[cat];
      if (pctDef) {
        averages[cat] = round2(teamPctAvg(players, pctDef.num, pctDef.den));
      } else {
        const field = STAT_TO_AVG[cat];
        if (!field) { averages[cat] = 0; continue; }
        // Sum all players' per-game averages → team's expected per-game total
        let sum = 0;
        for (const p of players) sum += (p[field] as number) ?? 0;
        averages[cat] = round2(sum);
      }
    }
    results.push({ teamId, averages });
  }
  return results;
}

// ── Radar Chart Data ────────────────────────────────────────────────────────

export interface RadarPoint {
  cat: CatName;
  /** My team's value normalized 0-1 within league range */
  myNorm: number;
  /** My raw value */
  myRaw: number;
  /** League average normalized */
  leagueNorm: number;
  /** League average raw */
  leagueAvgRaw: number;
  inverse: boolean;
}

/** Build radar chart data: normalize each category 0-1 within league min-max */
export function buildRadarData(
  teamAvgs: TeamCategoryAvg[],
  myTeamId: string,
): RadarPoint[] | null {
  if (teamAvgs.length < 2) return null;
  const my = teamAvgs.find((t) => t.teamId === myTeamId);
  if (!my) return null;

  return CAT_ORDER.map((cat) => {
    const values = teamAvgs.map((t) => t.averages[cat]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const leagueAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const inverse = INVERSE_CATS.has(cat);

    // For inverse stats (TO), lower is better → flip normalization
    const normalize = (v: number) => inverse ? 1 - (v - min) / range : (v - min) / range;

    return {
      cat,
      myNorm: normalize(my.averages[cat]),
      myRaw: my.averages[cat],
      leagueNorm: normalize(leagueAvg),
      leagueAvgRaw: round2(leagueAvg),
      inverse,
    };
  });
}

// ── Z-Score Composite ───────────────────────────────────────────────────────

export interface CategoryZScore {
  cat: CatName;
  zScore: number;
}

/** Compute per-category z-scores for a team relative to the league */
export function computeTeamZScores(
  teamAvgs: TeamCategoryAvg[],
  myTeamId: string,
): CategoryZScore[] {
  const my = teamAvgs.find((t) => t.teamId === myTeamId);
  if (!my) return [];

  return CAT_ORDER.map((cat) => {
    const values = teamAvgs.map((t) => t.averages[cat]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
    const raw = stdDev > 0 ? (my.averages[cat] - mean) / stdDev : 0;
    // For inverse stats, flip the z-score (lower TO = positive z)
    const zScore = INVERSE_CATS.has(cat) ? -raw : raw;
    return { cat, zScore: round2(zScore) };
  });
}

/** Sum of z-scores across all categories — composite "value" for scatter plots */
export function compositeZScore(zScores: CategoryZScore[]): number {
  return round2(zScores.reduce((s, z) => s + z.zScore, 0));
}

// ── Scatter Data (Age vs Stat or Composite) ─────────────────────────────────

export interface CatScatterPoint {
  name: string;
  shortName: string;
  age: number;
  value: number;
  playerId: string;
  position: string;
}

/** Build scatter data for a specific stat or composite z-score */
export function buildCatScatterData(
  players: PlayerSeasonStats[],
  stat: CatName | 'COMPOSITE',
  teamAvgs?: TeamCategoryAvg[],
): CatScatterPoint[] {
  return players
    .filter((p) => p.birthdate && p.games_played >= 5)
    .map((p) => {
      const age = calculateAge(p.birthdate!);
      let value: number;

      if (stat === 'COMPOSITE') {
        // Per-player composite: sum of z-scored stats relative to all players in list
        value = 0; // Will be computed in a second pass
      } else {
        value = getPlayerStatValue(p, stat);
      }

      return {
        name: p.name,
        shortName: shortDisplayName(p.name),
        age,
        value,
        playerId: p.player_id,
        position: p.position,
      };
    });
}

/** Get a single stat value for a player */
export function getPlayerStatValue(p: PlayerSeasonStats, stat: CatName): number {
  const pctDef = PCT_STATS[stat];
  if (pctDef) {
    const num = (p[pctDef.num] as number) ?? 0;
    const den = (p[pctDef.den] as number) ?? 0;
    return den > 0 ? round2((num / den) * 100) : 0;
  }
  const field = STAT_TO_AVG[stat];
  return field ? round2((p[field] as number) ?? 0) : 0;
}

/** Build composite scatter: each player gets a z-score sum vs the group */
export function buildCompositeScatter(
  players: PlayerSeasonStats[],
): CatScatterPoint[] {
  const eligible = players.filter((p) => p.birthdate && p.games_played >= 5);
  if (eligible.length < 3) return [];

  // Compute mean and stddev for each counting stat across eligible players
  const statValues: Record<string, number[]> = {};
  for (const cat of CAT_ORDER) {
    statValues[cat] = eligible.map((p) => getPlayerStatValue(p, cat));
  }

  const statMeans: Record<string, number> = {};
  const statStds: Record<string, number> = {};
  for (const cat of CAT_ORDER) {
    const vals = statValues[cat];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length);
    statMeans[cat] = mean;
    statStds[cat] = std;
  }

  return eligible.map((p) => {
    let composite = 0;
    for (const cat of CAT_ORDER) {
      const val = getPlayerStatValue(p, cat);
      const z = statStds[cat] > 0 ? (val - statMeans[cat]) / statStds[cat] : 0;
      composite += INVERSE_CATS.has(cat) ? -z : z;
    }
    return {
      name: p.name,
      shortName: shortDisplayName(p.name),
      age: calculateAge(p.birthdate!),
      value: round2(composite),
      playerId: p.player_id,
      position: p.position,
    };
  });
}

// ── Age Tier Breakdown per Category ─────────────────────────────────────────

export interface AgeTierBreakdown {
  cat: CatName;
  rising: number;   // sum of per-game avg from rising players
  prime: number;
  vet: number;
  total: number;
  risingPct: number; // % of total from rising
  primePct: number;
  vetPct: number;
}

/** Break down each category's production by age tier (Rising/Prime/Vet) */
export function buildAgeTierBreakdown(players: PlayerSeasonStats[]): AgeTierBreakdown[] {
  const eligible = players.filter((p) => p.birthdate && p.games_played >= 1);

  return CAT_ORDER.map((cat) => {
    let rising = 0, prime = 0, vet = 0;

    for (const p of eligible) {
      const val = getPlayerStatValue(p, cat);
      const bucket = ageBucket(calculateAge(p.birthdate!));
      if (bucket === 'rising') rising += val;
      else if (bucket === 'prime') prime += val;
      else vet += val;
    }

    // For percentage stats, we need volume-weighted approach instead
    const pctDef = PCT_STATS[cat];
    if (pctDef) {
      let risingNum = 0, risingDen = 0;
      let primeNum = 0, primeDen = 0;
      let vetNum = 0, vetDen = 0;

      for (const p of eligible) {
        const num = (p[pctDef.num] as number) ?? 0;
        const den = (p[pctDef.den] as number) ?? 0;
        const bucket = ageBucket(calculateAge(p.birthdate!));
        if (bucket === 'rising') { risingNum += num; risingDen += den; }
        else if (bucket === 'prime') { primeNum += num; primeDen += den; }
        else { vetNum += num; vetDen += den; }
      }

      rising = risingDen > 0 ? round2((risingNum / risingDen) * 100) : 0;
      prime = primeDen > 0 ? round2((primeNum / primeDen) * 100) : 0;
      vet = vetDen > 0 ? round2((vetNum / vetDen) * 100) : 0;

      // For pct stats, "total" is the team-wide pct
      const totalNum = risingNum + primeNum + vetNum;
      const totalDen = risingDen + primeDen + vetDen;
      const total = totalDen > 0 ? round2((totalNum / totalDen) * 100) : 0;

      // Pct contribution by attempts volume
      const totalAttempts = risingDen + primeDen + vetDen;
      return {
        cat,
        rising, prime, vet, total,
        risingPct: totalAttempts > 0 ? round1((risingDen / totalAttempts) * 100) : 0,
        primePct: totalAttempts > 0 ? round1((primeDen / totalAttempts) * 100) : 0,
        vetPct: totalAttempts > 0 ? round1((vetDen / totalAttempts) * 100) : 0,
      };
    }

    const total = rising + prime + vet;
    return {
      cat,
      rising: round2(rising),
      prime: round2(prime),
      vet: round2(vet),
      total: round2(total),
      risingPct: total > 0 ? round1((rising / total) * 100) : 0,
      primePct: total > 0 ? round1((prime / total) * 100) : 0,
      vetPct: total > 0 ? round1((vet / total) * 100) : 0,
    };
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
