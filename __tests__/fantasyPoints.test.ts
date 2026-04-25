import { PlayerSeasonStats, PlayerGameLog, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints, calculateGameFantasyPoints } from '@/utils/fantasyPoints';

// Helper to build a minimal PlayerSeasonStats with defaults
function makePlayer(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    player_id: 'p1', name: 'Test Player', position: 'PG', pro_team: 'LAL',
    status: 'active', external_id_nba: null, rookie: false,
    season_added: null, draft_year: null, birthdate: null, games_played: 0,
    total_pts: 0, total_reb: 0, total_ast: 0, total_stl: 0, total_blk: 0,
    total_tov: 0, total_fgm: 0, total_fga: 0, total_3pm: 0, total_3pa: 0,
    total_ftm: 0, total_fta: 0, total_pf: 0, total_dd: 0, total_td: 0,
    avg_min: 0, avg_pts: 0, avg_reb: 0, avg_ast: 0, avg_stl: 0, avg_blk: 0,
    avg_tov: 0, avg_fgm: 0, avg_fga: 0, avg_3pm: 0, avg_3pa: 0,
    avg_ftm: 0, avg_fta: 0, avg_pf: 0,
    ...overrides,
  };
}

// Helper for a single game log
function makeGame(overrides: Partial<PlayerGameLog> = {}): PlayerGameLog {
  return {
    id: 'g1', game_id: 'gm1', min: 0,
    pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    fgm: 0, fga: 0, '3pm': 0, '3pa': 0, ftm: 0, fta: 0, pf: 0,
    double_double: false, triple_double: false,
    ...overrides,
  };
}

const STANDARD_WEIGHTS: ScoringWeight[] = [
  { stat_name: 'PTS', point_value: 1 },
  { stat_name: 'REB', point_value: 1.2 },
  { stat_name: 'AST', point_value: 1.5 },
  { stat_name: 'STL', point_value: 3 },
  { stat_name: 'BLK', point_value: 3 },
  { stat_name: 'TO', point_value: -1 },
];

// ─── calculateAvgFantasyPoints ──────────────────────────────────────────────

describe('calculateAvgFantasyPoints', () => {
  it('returns 0 for zero games played', () => {
    const player = makePlayer({ games_played: 0 });
    expect(calculateAvgFantasyPoints(player, STANDARD_WEIGHTS)).toBe(0);
  });

  it('computes avg from season totals', () => {
    const player = makePlayer({
      games_played: 10,
      total_pts: 200,  // 200 * 1 = 200
      total_reb: 100,  // 100 * 1.2 = 120
      total_ast: 50,   // 50 * 1.5 = 75
      total_stl: 20,   // 20 * 3 = 60
      total_blk: 10,   // 10 * 3 = 30
      total_tov: 30,   // 30 * -1 = -30
    });
    // Total FPTS = 200 + 120 + 75 + 60 + 30 - 30 = 455
    // Avg = 455 / 10 = 45.50
    expect(calculateAvgFantasyPoints(player, STANDARD_WEIGHTS)).toBe(45.5);
  });

  it('rounds to 2 decimal places', () => {
    const player = makePlayer({
      games_played: 3,
      total_pts: 10, // 10 * 1 = 10. 10/3 = 3.333...
    });
    const weights: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 1 }];
    expect(calculateAvgFantasyPoints(player, weights)).toBe(3.33);
  });

  it('handles negative weights (turnovers)', () => {
    const player = makePlayer({
      games_played: 5,
      total_tov: 25, // 25 * -1 = -25. -25/5 = -5
    });
    const weights: ScoringWeight[] = [{ stat_name: 'TO', point_value: -1 }];
    expect(calculateAvgFantasyPoints(player, weights)).toBe(-5);
  });

  it('ignores stats not in weights', () => {
    const player = makePlayer({
      games_played: 1,
      total_pts: 100,
      total_reb: 50,
    });
    const weights: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 1 }];
    expect(calculateAvgFantasyPoints(player, weights)).toBe(100);
  });
});

// ─── calculateGameFantasyPoints ─────────────────────────────────────────────

describe('calculateGameFantasyPoints', () => {
  it('calculates points for a normal game', () => {
    const game = makeGame({ pts: 25, reb: 10, ast: 5, stl: 2, blk: 1, tov: 3 });
    // 25*1 + 10*1.2 + 5*1.5 + 2*3 + 1*3 + 3*-1 = 25 + 12 + 7.5 + 6 + 3 - 3 = 50.5
    expect(calculateGameFantasyPoints(game, STANDARD_WEIGHTS)).toBe(50.5);
  });

  it('handles boolean stats (double_double, triple_double)', () => {
    const game = makeGame({ double_double: true, triple_double: true });
    const weights: ScoringWeight[] = [
      { stat_name: 'DD', point_value: 5 },
      { stat_name: 'TD', point_value: 10 },
    ];
    expect(calculateGameFantasyPoints(game, weights)).toBe(15);
  });

  it('boolean false counts as 0', () => {
    const game = makeGame({ double_double: false });
    const weights: ScoringWeight[] = [{ stat_name: 'DD', point_value: 5 }];
    expect(calculateGameFantasyPoints(game, weights)).toBe(0);
  });

  it('all-zero game returns 0', () => {
    const game = makeGame();
    expect(calculateGameFantasyPoints(game, STANDARD_WEIGHTS)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    const game = makeGame({ pts: 1 });
    const weights: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 0.333 }];
    expect(calculateGameFantasyPoints(game, weights)).toBe(0.33);
  });
});
