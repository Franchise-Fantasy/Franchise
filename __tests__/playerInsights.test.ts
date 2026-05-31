import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from '@/types/player';
import type { CategoryDef } from '@/utils/scoring/categoryScoring';
import {
  calculateB2BImpact,
  calculateBounceBack,
  calculateCategoryInsights,
  calculateHomeSplit,
  calculatePlayerInsights,
  calculateStatBreakdown,
} from '@/utils/scoring/playerInsights';

const WEIGHTS: ScoringWeight[] = [
  { stat_name: 'PTS', point_value: 1 },
  { stat_name: 'REB', point_value: 1.2 },
  { stat_name: 'AST', point_value: 1.5 },
  { stat_name: 'TO', point_value: -1 },
];

function makeGame(overrides: Partial<PlayerGameLog> = {}): PlayerGameLog {
  return {
    id: 'g', game_id: 'g',
    matchup: 'vs LAL',
    game_date: '2026-02-01',
    min: 30, pts: 20, reb: 6, ast: 4, stl: 1, blk: 1, tov: 2,
    fgm: 8, fga: 16, '3pm': 2, '3pa': 5, ftm: 4, fta: 5, pf: 2,
    double_double: false, triple_double: false,
    ...overrides,
  };
}

function makeSeason(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    player_id: 'p1', name: 'Test Player', position: 'PG', pro_team: 'LAL',
    status: 'active', external_id_nba: null, rookie: false,
    season_added: null, draft_year: null, birthdate: null,
    games_played: 10,
    total_pts: 200, total_reb: 60, total_ast: 40, total_stl: 10, total_blk: 10,
    total_tov: 20, total_fgm: 80, total_fga: 160, total_3pm: 20, total_3pa: 50,
    total_ftm: 40, total_fta: 50, total_pf: 20, total_dd: 0, total_td: 0,
    avg_min: 30, avg_pts: 20, avg_reb: 6, avg_ast: 4, avg_stl: 1, avg_blk: 1,
    avg_tov: 2, avg_fgm: 8, avg_fga: 16, avg_3pm: 2, avg_3pa: 5,
    avg_ftm: 4, avg_fta: 5, avg_pf: 2,
    ...overrides,
  };
}

describe('calculatePlayerInsights', () => {
  it('returns null when fewer than 5 played games', () => {
    const games = Array.from({ length: 4 }, () => makeGame());
    expect(calculatePlayerInsights(games, WEIGHTS, 30)).toBeNull();
  });

  it('returns null when only DNPs', () => {
    const games = Array.from({ length: 10 }, () => makeGame({ min: 0 }));
    expect(calculatePlayerInsights(games, WEIGHTS, 30)).toBeNull();
  });

  it('returns labels and percentiles for a real sample', () => {
    const games = [
      makeGame({ pts: 20, reb: 6 }), makeGame({ pts: 22, reb: 5 }),
      makeGame({ pts: 18, reb: 7 }), makeGame({ pts: 21, reb: 4 }),
      makeGame({ pts: 19, reb: 6 }), makeGame({ pts: 23, reb: 5 }),
      makeGame({ pts: 25, reb: 6 }), makeGame({ pts: 17, reb: 5 }),
    ];
    const seasonAvg = games.reduce((s, g) => s + g.pts, 0) / games.length;
    const result = calculatePlayerInsights(games, WEIGHTS, seasonAvg)!;
    expect(result.gamesUsed).toBe(8);
    expect(result.high).toBeGreaterThan(result.low);
    expect(result.ceiling).toBeGreaterThanOrEqual(result.floor);
    expect(['Rock Solid', 'Steady', 'Variable', 'Boom or Bust']).toContain(result.consistency);
    expect(['scorching', 'hot', 'neutral', 'cold', 'frigid']).toContain(result.trend);
  });

  it('flags "scorching" trend when recent window is well above season avg', () => {
    const games = [
      // Recent (high)
      makeGame({ pts: 40 }), makeGame({ pts: 38 }), makeGame({ pts: 42 }), makeGame({ pts: 39 }), makeGame({ pts: 41 }),
      // Older (low)
      makeGame({ pts: 10 }), makeGame({ pts: 12 }), makeGame({ pts: 8 }), makeGame({ pts: 11 }), makeGame({ pts: 9 }),
    ];
    const seasonAvg = 25; // halfway
    const result = calculatePlayerInsights(games, WEIGHTS, seasonAvg, 5)!;
    expect(['hot', 'scorching']).toContain(result.trend);
  });
});

describe('calculateStatBreakdown', () => {
  it('returns [] for a player with no games', () => {
    expect(calculateStatBreakdown(makeSeason({ games_played: 0 }), WEIGHTS)).toEqual([]);
  });

  it('returns categories sorted by absolute pct', () => {
    const result = calculateStatBreakdown(makeSeason(), WEIGHTS);
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i - 1].pct)).toBeGreaterThanOrEqual(Math.abs(result[i].pct));
    }
  });

  it('drops entries with 0% contribution', () => {
    // Player has 0 of all stats but TO; only TO should appear.
    const player = makeSeason({
      total_pts: 0, total_reb: 0, total_ast: 0, total_tov: 10,
    });
    const result = calculateStatBreakdown(player, WEIGHTS);
    expect(result.length).toBeGreaterThan(0);
    // Should not have entries with pct == 0
    for (const r of result) expect(r.pct).not.toBe(0);
  });
});

describe('calculateHomeSplit', () => {
  it('returns null if < 3 home or < 3 away games', () => {
    const games = [
      makeGame({ matchup: 'vs LAL' }), makeGame({ matchup: 'vs BOS' }),
      makeGame({ matchup: '@MIA' }), makeGame({ matchup: '@MIA' }), makeGame({ matchup: '@MIA' }),
    ];
    expect(calculateHomeSplit(games, WEIGHTS)).toBeNull();
  });

  it('splits home (no @) and away (@) games correctly', () => {
    const games = [
      makeGame({ matchup: 'vs LAL', pts: 30 }),
      makeGame({ matchup: 'vs BOS', pts: 30 }),
      makeGame({ matchup: 'vs CHI', pts: 30 }),
      makeGame({ matchup: '@MIA', pts: 10 }),
      makeGame({ matchup: '@PHX', pts: 10 }),
      makeGame({ matchup: '@DEN', pts: 10 }),
    ];
    const split = calculateHomeSplit(games, WEIGHTS)!;
    expect(split.homeGames).toBe(3);
    expect(split.awayGames).toBe(3);
    expect(split.homeAvg).toBeGreaterThan(split.awayAvg);
  });
});

describe('calculateB2BImpact', () => {
  it('returns null when no dated games', () => {
    expect(calculateB2BImpact([makeGame({ game_date: undefined })], WEIGHTS)).toBeNull();
  });

  it('detects back-to-back games by date diff of 1 day', () => {
    const games = [
      makeGame({ game_date: '2026-02-01', pts: 20 }),
      makeGame({ game_date: '2026-02-02', pts: 15 }), // B2B
      makeGame({ game_date: '2026-02-04', pts: 25 }), // rest
      makeGame({ game_date: '2026-02-05', pts: 10 }), // B2B
      makeGame({ game_date: '2026-02-07', pts: 22 }), // rest
    ];
    const result = calculateB2BImpact(games, WEIGHTS)!;
    expect(result.totalB2Bs).toBe(2);
    expect(result.b2bGames).toBe(2);
    expect(result.restGames).toBe(2);
  });

  it('counts a DNP on the back-end of a B2B as "sat out"', () => {
    const games = [
      makeGame({ game_date: '2026-02-01', pts: 20 }),
      makeGame({ game_date: '2026-02-02', pts: 0, min: 0 }), // sat out the B2B
      makeGame({ game_date: '2026-02-04', pts: 25 }),
      makeGame({ game_date: '2026-02-05', pts: 0, min: 0 }), // sat out B2B
    ];
    const result = calculateB2BImpact(games, WEIGHTS)!;
    expect(result.totalB2Bs).toBe(2);
    expect(result.b2bSatOut).toBe(2);
  });
});

describe('calculateBounceBack', () => {
  it('returns null when fewer than 5 played games', () => {
    const games = Array.from({ length: 4 }, () => makeGame());
    expect(calculateBounceBack(games, WEIGHTS, 20)).toBeNull();
  });

  it('returns null when fewer than 3 below-floor games', () => {
    const games = Array.from({ length: 10 }, () => makeGame({ pts: 20 }));
    // All identical → no below-floor cases.
    expect(calculateBounceBack(games, WEIGHTS, 20)).toBeNull();
  });
});

describe('calculateCategoryInsights', () => {
  const cats: CategoryDef[] = [
    { stat_name: 'PTS', inverse: false },
    { stat_name: 'REB', inverse: false },
    { stat_name: 'TO', inverse: true },
    { stat_name: 'FG%', inverse: false },
  ];

  it('returns null with fewer than 5 played games', () => {
    const games = Array.from({ length: 4 }, () => makeGame());
    expect(calculateCategoryInsights(games, cats)).toBeNull();
  });

  it('returns per-category seasonAvg, recentAvg, consistency, trend', () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      makeGame({ pts: 20 + i, fgm: 8, fga: 16 }),
    );
    const result = calculateCategoryInsights(games, cats)!;
    expect(result.gamesUsed).toBe(10);
    expect(result.categories.length).toBe(cats.length);
    const pts = result.categories.find((c) => c.stat_name === 'PTS')!;
    expect(pts.seasonAvg).toBeGreaterThan(0);
    expect(['Rock Solid', 'Steady', 'Variable', 'Boom or Bust']).toContain(pts.consistency);
  });

  it('computes FG% as fgm/fga * 100', () => {
    const games = Array.from({ length: 6 }, () => makeGame({ fgm: 5, fga: 10 }));
    const result = calculateCategoryInsights(games, cats)!;
    const fg = result.categories.find((c) => c.stat_name === 'FG%')!;
    expect(fg.seasonAvg).toBe(50);
  });
});
