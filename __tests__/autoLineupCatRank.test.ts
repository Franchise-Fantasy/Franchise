import { PlayerGameLog, PlayerSeasonStats } from '@/types/player';
import { buildAutoLineupCatRanks } from '@/utils/roster/autoLineupCatRank';

function makePlayer(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    player_id: 'p1', name: 'Test Player', position: 'PG', pro_team: 'LAL',
    status: 'active', external_id_nba: null, rookie: false,
    season_added: null, draft_year: null, birthdate: '2000-01-01', games_played: 20,
    total_pts: 250, total_reb: 50, total_ast: 50, total_stl: 10, total_blk: 5,
    total_tov: 20, total_fgm: 90, total_fga: 200, total_3pm: 20, total_3pa: 60,
    total_ftm: 50, total_fta: 60, total_pf: 25, total_dd: 0, total_td: 0,
    avg_min: 30, avg_pts: 25, avg_reb: 5, avg_ast: 5, avg_stl: 1, avg_blk: 0.5,
    avg_tov: 2, avg_fgm: 9, avg_fga: 20, avg_3pm: 2, avg_3pa: 6,
    avg_ftm: 5, avg_fta: 6, avg_pf: 2.5,
    ...overrides,
  };
}

/** The columns player_historical_stats actually has — no birthdate, no name,
 *  no shooting totals. Mirrors the fallback cast in runAutoLineup. */
function makeHistRow(player_id: string, avg_pts: number): PlayerSeasonStats {
  return {
    player_id, games_played: 60,
    avg_pts, avg_reb: 6, avg_ast: 5, avg_stl: 1.2, avg_blk: 0.6,
    avg_tov: 2.2, avg_3pm: 2, avg_3pa: 6, avg_fgm: avg_pts / 2.5, avg_fga: avg_pts / 1.3,
    avg_ftm: 4, avg_fta: 5, avg_min: 32, avg_pf: 2, total_dd: 5, total_td: 0,
  } as unknown as PlayerSeasonStats;
}

function makeGame(overrides: Partial<PlayerGameLog> = {}): PlayerGameLog {
  return {
    id: 'g1', game_id: 'game1', min: 30, pts: 20, reb: 5, ast: 4, stl: 1,
    blk: 0.5, tov: 2, fgm: 8, fga: 16, '3pm': 2, '3pa': 5, ftm: 2, fta: 3,
    pf: 2, double_double: false, triple_double: false,
    ...overrides,
  };
}

const NO_WINDOW = {
  winSize: null,
  logsByPlayer: undefined,
  leagueCats: undefined,
  minCurrentSeasonGames: 10,
};

describe('buildAutoLineupCatRanks', () => {
  it('every rank is >= 1 (optimizer treats 0 as "no game today")', () => {
    const players = [
      makePlayer({ player_id: 'a', avg_pts: 30 }),
      makePlayer({ player_id: 'b', avg_pts: 15 }),
      makePlayer({ player_id: 'c', avg_pts: 5 }),
    ];
    const ranks = buildAutoLineupCatRanks({ ...NO_WINDOW, players, prevSeasonStats: new Map() });
    expect(ranks.size).toBe(3);
    for (const v of ranks.values()) expect(v).toBeGreaterThanOrEqual(1);
    expect(ranks.get('a')!).toBeGreaterThan(ranks.get('c')!);
  });

  it('under-sampled players rank from their historical row instead of zeroing out', () => {
    // The original bug: everyone under MIN games (offseason / early season)
    // fell back to player_historical_stats rows, which have no birthdate —
    // the old scatter-based composite filtered them ALL out and the optimizer
    // saw a roster of zeros.
    const players = [
      makePlayer({ player_id: 'star', games_played: 0, avg_pts: 0, avg_fgm: 0, avg_fga: 0 }),
      makePlayer({ player_id: 'role', games_played: 0, avg_pts: 0, avg_fgm: 0, avg_fga: 0 }),
      makePlayer({ player_id: 'scrub', games_played: 0, avg_pts: 0, avg_fgm: 0, avg_fga: 0 }),
    ];
    const prevSeasonStats = new Map([
      ['star', makeHistRow('star', 31)],
      ['role', makeHistRow('role', 14)],
      ['scrub', makeHistRow('scrub', 4)],
    ]);
    const ranks = buildAutoLineupCatRanks({ ...NO_WINDOW, players, prevSeasonStats });
    expect(ranks.get('star')!).toBeGreaterThan(ranks.get('role')!);
    expect(ranks.get('role')!).toBeGreaterThan(ranks.get('scrub')!);
  });

  it('uses the windowed slice when a window is active and the log has games', () => {
    // Season averages say "cold" is better; the last-5 window says "hot" is.
    const players = [
      makePlayer({ player_id: 'hot', avg_pts: 10 }),
      makePlayer({ player_id: 'cold', avg_pts: 25 }),
    ];
    const logsByPlayer = new Map<string, PlayerGameLog[]>([
      ['hot', Array.from({ length: 5 }, (_, i) => makeGame({ id: `h${i}`, pts: 35 }))],
      ['cold', Array.from({ length: 5 }, (_, i) => makeGame({ id: `c${i}`, pts: 6 }))],
    ]);
    const ranks = buildAutoLineupCatRanks({
      players,
      prevSeasonStats: new Map(),
      winSize: 5,
      logsByPlayer,
      leagueCats: [{ stat_name: 'PTS' }],
      minCurrentSeasonGames: 10,
    });
    expect(ranks.get('hot')!).toBeGreaterThan(ranks.get('cold')!);
  });

  it('falls back to the own current-season row when no history exists', () => {
    const players = [
      makePlayer({ player_id: 'a', games_played: 3, avg_pts: 28 }),
      makePlayer({ player_id: 'b', games_played: 3, avg_pts: 9 }),
    ];
    const ranks = buildAutoLineupCatRanks({ ...NO_WINDOW, players, prevSeasonStats: new Map() });
    expect(ranks.get('a')!).toBeGreaterThan(ranks.get('b')!);
  });

  it('returns an empty map when nobody has any data (caller degrades gracefully)', () => {
    const players = [
      makePlayer({ player_id: 'a', games_played: 0 }),
      makePlayer({ player_id: 'b', games_played: 0 }),
    ];
    const ranks = buildAutoLineupCatRanks({ ...NO_WINDOW, players, prevSeasonStats: new Map() });
    expect(ranks.size).toBe(0);
  });
});
