/**
 * Pure functions for computing H2H category matchup results.
 * Used by both client (live display) and edge function (finalize-week).
 */

// Maps stat_name to player_games column key
const STAT_TO_GAME_KEY: Record<string, string> = {
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

// Percentage stat definitions — numerator/denominator map to game column keys
const PERCENTAGE_STATS: Record<string, { numerator: string; denominator: string }> = {
  'FG%': { numerator: 'fgm', denominator: 'fga' },
  'FT%': { numerator: 'ftm', denominator: 'fta' },
};

export interface TeamStatTotals {
  [statKey: string]: number;
}

export interface CategoryResult {
  stat: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
}

export interface CategoryMatchupResult {
  results: CategoryResult[];
  homeWins: number;
  awayWins: number;
  ties: number;
}

export interface CategoryDef {
  stat_name: string;
  inverse: boolean;
}

/**
 * Aggregate raw stats from an array of game logs.
 * Each game is a Record<string, number|boolean> (e.g. from player_games).
 * Boolean stats (double_double, triple_double) are converted to 1/0.
 */
export function aggregateTeamStats(
  gameLogs: Record<string, any>[],
): TeamStatTotals {
  const totals: TeamStatTotals = {};
  for (const game of gameLogs) {
    for (const [, gameKey] of Object.entries(STAT_TO_GAME_KEY)) {
      const raw = game[gameKey];
      if (raw == null) continue;
      const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
      totals[gameKey] = (totals[gameKey] ?? 0) + val;
    }
  }
  return totals;
}

/**
 * Compare two teams across enabled categories.
 * For counting stats: higher wins (or lower for inverse stats like TO).
 * For percentage stats: computed from made/attempted totals.
 */
export function computeCategoryResults(
  homeStats: TeamStatTotals,
  awayStats: TeamStatTotals,
  categories: CategoryDef[],
): CategoryMatchupResult {
  const results: CategoryResult[] = [];
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;

  for (const cat of categories) {
    const pctDef = PERCENTAGE_STATS[cat.stat_name];

    let homeVal: number;
    let awayVal: number;

    if (pctDef) {
      // Percentage stat — compute from made/attempted
      const homeNum = homeStats[pctDef.numerator] ?? 0;
      const homeDen = homeStats[pctDef.denominator] ?? 0;
      const awayNum = awayStats[pctDef.numerator] ?? 0;
      const awayDen = awayStats[pctDef.denominator] ?? 0;
      homeVal = homeDen > 0 ? Math.round((homeNum / homeDen) * 1000) / 1000 : 0;
      awayVal = awayDen > 0 ? Math.round((awayNum / awayDen) * 1000) / 1000 : 0;
    } else {
      // Counting stat — read directly
      const gameKey = STAT_TO_GAME_KEY[cat.stat_name];
      if (!gameKey) continue;
      homeVal = homeStats[gameKey] ?? 0;
      awayVal = awayStats[gameKey] ?? 0;
    }

    let winner: 'home' | 'away' | 'tie';
    if (homeVal === awayVal) {
      winner = 'tie';
      ties++;
    } else if (cat.inverse) {
      // Lower is better (e.g. turnovers)
      winner = homeVal < awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++;
      else awayWins++;
    } else {
      winner = homeVal > awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++;
      else awayWins++;
    }

    results.push({ stat: cat.stat_name, home: homeVal, away: awayVal, winner });
  }

  return { results, homeWins, awayWins, ties };
}

/** Format a category record string like "5-3-1" or "5-3" if no ties. */
export function formatCategoryRecord(homeWins: number, awayWins: number, ties: number): string {
  if (ties > 0) return `${homeWins}-${awayWins}-${ties}`;
  return `${homeWins}-${awayWins}`;
}
