import { PlayerGameLog, PlayerSeasonStats } from '@/types/player';
import {
  averageGames,
  buildWindowedStatRow,
  lastNPlayedGames,
} from '@/utils/scoring/windowAverages';

function makeGame(overrides: Partial<PlayerGameLog> = {}): PlayerGameLog {
  return {
    id: 'g', game_id: 'g',
    min: 30, pts: 20, reb: 5, ast: 4, stl: 1, blk: 1, tov: 2,
    fgm: 7, fga: 14, '3pm': 2, '3pa': 5, ftm: 4, fta: 5, pf: 2,
    double_double: false, triple_double: false,
    ...overrides,
  };
}

function makeBaseRow(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    player_id: 'p1', name: 'Test Player', position: 'PG', pro_team: 'LAL',
    status: 'active', external_id_nba: null, rookie: false,
    season_added: null, draft_year: null, birthdate: '1995-01-01', games_played: 40,
    total_pts: 800, total_reb: 200, total_ast: 160, total_stl: 40, total_blk: 40,
    total_tov: 80, total_fgm: 280, total_fga: 560, total_3pm: 80, total_3pa: 200,
    total_ftm: 160, total_fta: 200, total_pf: 80, total_dd: 0, total_td: 0,
    avg_min: 32, avg_pts: 20, avg_reb: 5, avg_ast: 4, avg_stl: 1, avg_blk: 1,
    avg_tov: 2, avg_fgm: 7, avg_fga: 14, avg_3pm: 2, avg_3pa: 5,
    avg_ftm: 4, avg_fta: 5, avg_pf: 2,
    ...overrides,
  };
}

describe('averageGames', () => {
  it('returns null when no games', () => {
    expect(averageGames([])).toBeNull();
  });

  it('returns null when every game is a DNP (min = 0)', () => {
    expect(averageGames([makeGame({ min: 0 }), makeGame({ min: 0 })])).toBeNull();
  });

  it('averages played games only — excludes DNPs', () => {
    const rows = [
      makeGame({ min: 30, pts: 20 }),
      makeGame({ min: 0, pts: 99 }), // DNP — should be excluded
      makeGame({ min: 28, pts: 10 }),
    ];
    const result = averageGames(rows)!;
    expect(result.games_played).toBe(2);
    expect(result.avg_pts).toBe(15);
  });

  it('returns per-game averages for all stat columns', () => {
    const rows = [
      makeGame({ pts: 20, reb: 10, ast: 5, fgm: 8, fga: 16, ftm: 4, fta: 4 }),
      makeGame({ pts: 30, reb: 8, ast: 7, fgm: 12, fga: 20, ftm: 6, fta: 8 }),
    ];
    const result = averageGames(rows)!;
    expect(result.games_played).toBe(2);
    expect(result.avg_pts).toBe(25);
    expect(result.avg_reb).toBe(9);
    expect(result.avg_ast).toBe(6);
    expect(result.avg_fgm).toBe(10);
    expect(result.avg_fga).toBe(18);
    expect(result.avg_ftm).toBe(5);
    expect(result.avg_fta).toBe(6);
  });

  it('treats null/undefined stat values as 0', () => {
    const broken = makeGame();
    // simulate sparse row by clearing pts
    (broken as any).pts = null;
    const result = averageGames([broken, makeGame({ pts: 30 })])!;
    expect(result.avg_pts).toBe(15);
  });
});

describe('lastNPlayedGames', () => {
  it('returns [] for an empty or missing log', () => {
    expect(lastNPlayedGames(undefined, 5)).toEqual([]);
    expect(lastNPlayedGames([], 5)).toEqual([]);
  });

  it('takes the first N played games (log is DESC = most recent first)', () => {
    const log = [
      makeGame({ pts: 50 }), // most recent
      makeGame({ pts: 40 }),
      makeGame({ pts: 30 }),
      makeGame({ pts: 20 }),
    ];
    const result = lastNPlayedGames(log, 2);
    expect(result.map((g) => g.pts)).toEqual([50, 40]);
  });

  it('skips DNPs and still fills the window from played games', () => {
    const log = [
      makeGame({ min: 0, pts: 99 }), // DNP
      makeGame({ min: 0, pts: 98 }), // DNP
      makeGame({ pts: 30 }),
      makeGame({ pts: 20 }),
      makeGame({ pts: 10 }),
    ];
    // Window of 2 grabs 2x (4 rows: 2 DNP + 2 played) then keeps 2 played.
    const result = lastNPlayedGames(log, 2);
    expect(result.map((g) => g.pts)).toEqual([30, 20]);
  });
});

describe('buildWindowedStatRow', () => {
  it('returns null when the window has no played games', () => {
    expect(buildWindowedStatRow(makeBaseRow(), [], 5)).toBeNull();
    expect(buildWindowedStatRow(makeBaseRow(), undefined, 5)).toBeNull();
  });

  it('overrides avg + total fields from the window but keeps identity fields', () => {
    const base = makeBaseRow({ avg_pts: 20, name: 'Star', birthdate: '1990-06-15' });
    const log = [
      makeGame({ pts: 40, reb: 10, fgm: 10, fga: 20 }),
      makeGame({ pts: 30, reb: 8, fgm: 8, fga: 16 }),
    ];
    const row = buildWindowedStatRow(base, log, 5)!;
    // Identity preserved
    expect(row.name).toBe('Star');
    expect(row.birthdate).toBe('1990-06-15');
    expect(row.position).toBe('PG');
    // Windowed averages
    expect(row.games_played).toBe(2);
    expect(row.avg_pts).toBe(35);
    expect(row.avg_reb).toBe(9);
    // Totals reconstructed as avg × games (used by the cat % composite)
    expect(row.total_fgm).toBe(Math.round(9 * 2)); // avg_fgm 9 × 2 games
    expect(row.total_fga).toBe(Math.round(18 * 2));
  });
});
