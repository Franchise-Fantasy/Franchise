// Pure scoring helpers shared between finalize-week (the recap path) and any
// future caller that needs the same math. Extracted from
// finalize-week/index.ts as part of PR 10's decomposition.
//
// Nothing in this module touches the DB — every function takes its inputs
// explicitly. Pair with dataLoader.ts (bulk fetch + indexing) and
// teamScoring.ts (compute team totals from indexed data).

import { resolveSlot as sharedResolveSlot } from '../resolveSlot.ts';

export const STAT_TO_GAME: Record<string, string> = {
  PTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  TO: 'tov',
  '3PM': '3pm',
  '3PA': '3pa',
  FGM: 'fgm',
  FGA: 'fga',
  FTM: 'ftm',
  FTA: 'fta',
  PF: 'pf',
  DD: 'double_double',
  TD: 'triple_double',
};

export interface ScoringWeight {
  stat_name: string;
  point_value: number;
  is_enabled: boolean;
  inverse: boolean;
}

export interface PlayerGameEntry {
  date: string;
  slot: string;
  fpts: number;
  stats: Record<string, unknown>;
  matchup: string | null;
}

export interface PlayerScoreEntry {
  player_id: string;
  name: string;
  position: string | null;
  pro_team: string | null;
  external_id_nba: string | null;
  roster_slot: string;
  week_points: number;
  games: PlayerGameEntry[];
}

export interface CategoryResult {
  stat: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
}

const PERCENTAGE_STATS: Record<string, { numerator: string; denominator: string }> = {
  'FG%': { numerator: 'fgm', denominator: 'fga' },
  'FT%': { numerator: 'ftm', denominator: 'fta' },
};

export function aggregateGameStats(
  gameLogs: Record<string, unknown>[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const game of gameLogs) {
    for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
      const raw = game[gameKey];
      if (raw == null) continue;
      const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
      totals[gameKey] = (totals[gameKey] ?? 0) + val;
    }
  }
  return totals;
}

export function compareCategoryStats(
  homeStats: Record<string, number>,
  awayStats: Record<string, number>,
  categories: ScoringWeight[],
): { results: CategoryResult[]; homeWins: number; awayWins: number; ties: number } {
  const results: CategoryResult[] = [];
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;

  for (const cat of categories) {
    if (!cat.is_enabled) continue;

    const pctDef = PERCENTAGE_STATS[cat.stat_name];
    let homeVal: number;
    let awayVal: number;

    if (pctDef) {
      const hNum = homeStats[pctDef.numerator] ?? 0;
      const hDen = homeStats[pctDef.denominator] ?? 0;
      const aNum = awayStats[pctDef.numerator] ?? 0;
      const aDen = awayStats[pctDef.denominator] ?? 0;
      homeVal = hDen > 0 ? Math.round((hNum / hDen) * 1000) / 1000 : 0;
      awayVal = aDen > 0 ? Math.round((aNum / aDen) * 1000) / 1000 : 0;
    } else {
      const gameKey = STAT_TO_GAME[cat.stat_name];
      if (!gameKey) continue;
      homeVal = homeStats[gameKey] ?? 0;
      awayVal = awayStats[gameKey] ?? 0;
    }

    let winner: 'home' | 'away' | 'tie';
    if (homeVal === awayVal) {
      winner = 'tie';
      ties++;
    } else if (cat.inverse) {
      winner = homeVal < awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++; else awayWins++;
    } else {
      winner = homeVal > awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++; else awayWins++;
    }

    results.push({ stat: cat.stat_name, home: homeVal, away: awayVal, winner });
  }

  return { results, homeWins, awayWins, ties };
}

export function calculateGameFpts(
  game: Record<string, number>,
  weights: ScoringWeight[],
): number {
  let total = 0;
  for (const w of weights) {
    const field = STAT_TO_GAME[w.stat_name];
    if (field && game[field] != null) {
      total += game[field] * w.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

export function resolveSlotForGame(
  dailyEntries: Array<{ lineup_date: string; roster_slot: string }>,
  day: string,
  defaultSlot: string,
  opts: { isOnCurrentRoster: boolean; dropDate?: string; acquiredDate?: string; today: string },
): string {
  return sharedResolveSlot({
    dailyEntries,
    day,
    defaultSlot,
    isOnCurrentRoster: opts.isOnCurrentRoster,
    dropDate: opts.dropDate,
    acquiredDate: opts.acquiredDate,
    today: opts.today,
  });
}

/**
 * Walks a team's per-game player scores and returns the day with the highest
 * single-day fpts total across the whole roster. Used to refresh the
 * `highest_scoring_day` league record on finalize.
 */
export function extractBestDay(
  playerScores: PlayerScoreEntry[],
): { total: number; date: string } | null {
  const byDate = new Map<string, number>();
  for (const ps of playerScores) {
    for (const g of ps.games) {
      if (!g.date) continue;
      byDate.set(g.date, (byDate.get(g.date) ?? 0) + g.fpts);
    }
  }
  let best: { total: number; date: string } | null = null;
  for (const [date, total] of byDate) {
    if (!best || total > best.total) best = { total, date };
  }
  return best;
}

/** Number of playoff rounds for a bracket of N playoff teams (4→2, 8→3, 16→4). */
export function calcRounds(playoffTeams: number): number {
  return Math.ceil(Math.log2(Math.max(2, playoffTeams)));
}
