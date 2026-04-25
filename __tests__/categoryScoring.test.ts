import {
  aggregateTeamStats,
  computeCategoryResults,
  formatCategoryRecord,
  CategoryDef,
  TeamStatTotals,
} from '@/utils/scoring/categoryScoring';

// ─── aggregateTeamStats ─────────────────────────────────────────────────────

describe('aggregateTeamStats', () => {
  it('returns empty object for no games', () => {
    expect(aggregateTeamStats([])).toEqual({});
  });

  it('sums a single game correctly', () => {
    const game = { pts: 25, reb: 10, ast: 5, stl: 2, blk: 1, tov: 3, fgm: 10, fga: 20 };
    const result = aggregateTeamStats([game]);
    expect(result.pts).toBe(25);
    expect(result.reb).toBe(10);
    expect(result.tov).toBe(3);
    expect(result.fgm).toBe(10);
    expect(result.fga).toBe(20);
  });

  it('sums multiple games', () => {
    const games = [
      { pts: 20, reb: 5, ast: 8 },
      { pts: 15, reb: 7, ast: 3 },
      { pts: 30, reb: 12, ast: 10 },
    ];
    const result = aggregateTeamStats(games);
    expect(result.pts).toBe(65);
    expect(result.reb).toBe(24);
    expect(result.ast).toBe(21);
  });

  it('handles boolean stats (double_double, triple_double)', () => {
    const games = [
      { double_double: true, triple_double: false },
      { double_double: true, triple_double: true },
      { double_double: false, triple_double: false },
    ];
    const result = aggregateTeamStats(games);
    expect(result.double_double).toBe(2);
    expect(result.triple_double).toBe(1);
  });

  it('skips null/undefined stat values', () => {
    const games = [
      { pts: 10, reb: null },
      { pts: 15 },
    ];
    const result = aggregateTeamStats(games);
    expect(result.pts).toBe(25);
    expect(result.reb).toBeUndefined();
  });
});

// ─── computeCategoryResults ─────────────────────────────────────────────────

describe('computeCategoryResults', () => {
  it('home wins a counting stat', () => {
    const home: TeamStatTotals = { pts: 100 };
    const away: TeamStatTotals = { pts: 80 };
    const cats: CategoryDef[] = [{ stat_name: 'PTS', inverse: false }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.homeWins).toBe(1);
    expect(result.awayWins).toBe(0);
    expect(result.ties).toBe(0);
    expect(result.results[0].winner).toBe('home');
  });

  it('away wins a counting stat', () => {
    const home: TeamStatTotals = { ast: 30 };
    const away: TeamStatTotals = { ast: 45 };
    const cats: CategoryDef[] = [{ stat_name: 'AST', inverse: false }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.awayWins).toBe(1);
    expect(result.results[0].winner).toBe('away');
  });

  it('handles ties', () => {
    const home: TeamStatTotals = { stl: 20 };
    const away: TeamStatTotals = { stl: 20 };
    const cats: CategoryDef[] = [{ stat_name: 'STL', inverse: false }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.ties).toBe(1);
    expect(result.results[0].winner).toBe('tie');
  });

  it('inverse stat: lower wins (turnovers)', () => {
    const home: TeamStatTotals = { tov: 10 };
    const away: TeamStatTotals = { tov: 15 };
    const cats: CategoryDef[] = [{ stat_name: 'TO', inverse: true }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.homeWins).toBe(1);
    expect(result.results[0].winner).toBe('home');
  });

  it('computes FG% from totals, not averages', () => {
    // Home: 45/100 = .450, Away: 40/80 = .500
    const home: TeamStatTotals = { fgm: 45, fga: 100 };
    const away: TeamStatTotals = { fgm: 40, fga: 80 };
    const cats: CategoryDef[] = [{ stat_name: 'FG%', inverse: false }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.awayWins).toBe(1);
    expect(result.results[0].home).toBe(0.45);
    expect(result.results[0].away).toBe(0.5);
  });

  it('FT% with zero attempts returns 0', () => {
    const home: TeamStatTotals = { ftm: 0, fta: 0 };
    const away: TeamStatTotals = { ftm: 10, fta: 12 };
    const cats: CategoryDef[] = [{ stat_name: 'FT%', inverse: false }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.results[0].home).toBe(0);
    expect(result.results[0].away).toBeCloseTo(0.833, 3);
    expect(result.awayWins).toBe(1);
  });

  it('handles multiple categories at once', () => {
    const home: TeamStatTotals = { pts: 100, reb: 50, tov: 12 };
    const away: TeamStatTotals = { pts: 90, reb: 55, tov: 15 };
    const cats: CategoryDef[] = [
      { stat_name: 'PTS', inverse: false },
      { stat_name: 'REB', inverse: false },
      { stat_name: 'TO', inverse: true },
    ];

    const result = computeCategoryResults(home, away, cats);
    // Home wins PTS (100>90) and TO (12<15), Away wins REB (55>50)
    expect(result.homeWins).toBe(2);
    expect(result.awayWins).toBe(1);
    expect(result.ties).toBe(0);
  });

  it('defaults missing stats to 0', () => {
    const home: TeamStatTotals = {};
    const away: TeamStatTotals = { pts: 10 };
    const cats: CategoryDef[] = [{ stat_name: 'PTS', inverse: false }];

    const result = computeCategoryResults(home, away, cats);
    expect(result.results[0].home).toBe(0);
    expect(result.awayWins).toBe(1);
  });
});

// ─── formatCategoryRecord ───────────────────────────────────────────────────

describe('formatCategoryRecord', () => {
  it('formats with ties', () => {
    expect(formatCategoryRecord(5, 3, 1)).toBe('5-3-1');
  });

  it('omits ties when zero', () => {
    expect(formatCategoryRecord(4, 5, 0)).toBe('4-5');
  });

  it('handles all zeros', () => {
    expect(formatCategoryRecord(0, 0, 0)).toBe('0-0');
  });
});
