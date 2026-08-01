import { PlayerSeasonStats } from '@/types/player';
import { buildAdjustedPlayers, deriveMinutesUpPlayerIds } from '@/utils/freeAgent/freeAgentStats';

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

// ─── buildAdjustedPlayers ─────────────────────────────────────────────────────

describe('buildAdjustedPlayers', () => {
  it('returns undefined when allPlayers is undefined', () => {
    expect(buildAdjustedPlayers(undefined, [], null, 'season')).toBeUndefined();
  });

  it('returns the season list unchanged for timeRange "season"', () => {
    const players = [makePlayer({ player_id: 'p1', avg_pts: 25 })];
    expect(buildAdjustedPlayers(players, [], null, 'season')).toBe(players);
  });

  it('falls back to the season list when lastSeason has no historical rows', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    expect(buildAdjustedPlayers(players, [], null, 'lastSeason')).toBe(players);
  });

  it('lastSeason merges historical averages and drops players without history', () => {
    const players = [
      makePlayer({ player_id: 'p1', name: 'Has History', avg_pts: 5 }),
      makePlayer({ player_id: 'p2', name: 'No History', avg_pts: 9 }),
    ];
    const historical = [{ player_id: 'p1', avg_pts: 22, games_played: 70 }];
    const result = buildAdjustedPlayers(players, [], historical, 'lastSeason')!;
    expect(result).toHaveLength(1);
    expect(result[0].player_id).toBe('p1');
    expect(result[0].name).toBe('Has History'); // identity stays current
    expect(result[0].avg_pts).toBe(22); // stats reflect last season
    expect(result[0].games_played).toBe(70);
  });

  it('lastSeason rebuilds EVERY box total from avg × games so FPTS matches the detail modal', () => {
    // The season row carries stale shooting totals (here 999) that must NOT leak
    // into the last-season FPTS. player_historical_stats persists only dd/td
    // totals, so the box totals get reconstructed from avg × games.
    const players = [makePlayer({ player_id: 'p1', total_fgm: 999, total_pf: 999 })];
    const historical = [{
      player_id: 'p1', games_played: 80,
      avg_pts: 10, avg_reb: 5, avg_ast: 4, avg_stl: 1, avg_blk: 0.5, avg_tov: 2,
      avg_fgm: 4, avg_fga: 9, avg_3pm: 1, avg_3pa: 3, avg_ftm: 2, avg_fta: 2.5, avg_pf: 3,
      total_dd: 12, total_td: 1,
    }];
    const r = buildAdjustedPlayers(players, [], historical, 'lastSeason')![0];
    expect(r.total_pts).toBe(800); // 10 × 80
    expect(r.total_fgm).toBe(320); // 4 × 80 — was leaking the stale 999
    expect(r.total_fga).toBe(720); // 9 × 80
    expect(r.total_3pm).toBe(80); // 1 × 80
    expect(r.total_3pa).toBe(240); // 3 × 80
    expect(r.total_ftm).toBe(160); // 2 × 80
    expect(r.total_fta).toBe(200); // 2.5 × 80
    expect(r.total_pf).toBe(240); // 3 × 80 — was leaking the stale 999
    // DD/TD come straight from the persisted historical totals (not reconstructed).
    expect(r.total_dd).toBe(12);
    expect(r.total_td).toBe(1);
  });

  it('averages the games in the window and drops players with none', () => {
    const players = [makePlayer({ player_id: 'p1' }), makePlayer({ player_id: 'p2' })];
    // Newest-first, as the query returns them.
    const logs = [
      { player_id: 'p1', game_date: '2026-06-04', min: 30, pts: 20, reb: 6, ast: 4 },
      { player_id: 'p1', game_date: '2026-06-02', min: 30, pts: 10, reb: 4, ast: 2 },
      // p2 has no games → dropped
    ];
    const result = buildAdjustedPlayers(players, logs, null, 'L5')!;
    expect(result).toHaveLength(1);
    expect(result[0].player_id).toBe('p1');
    expect(result[0].games_played).toBe(2);
    expect(result[0].total_pts).toBe(30);
    expect(result[0].avg_pts).toBe(15); // 30 / 2
    expect(result[0].avg_reb).toBe(5); // 10 / 2
  });

  it('keeps only the most recent N games for a window', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    // Six played games, newest first. L5 should use the five newest (pts 5) and
    // drop the sixth-oldest (pts 99).
    const logs = [
      { player_id: 'p1', game_date: '2026-06-06', min: 30, pts: 5 },
      { player_id: 'p1', game_date: '2026-06-05', min: 30, pts: 5 },
      { player_id: 'p1', game_date: '2026-06-04', min: 30, pts: 5 },
      { player_id: 'p1', game_date: '2026-06-03', min: 30, pts: 5 },
      { player_id: 'p1', game_date: '2026-06-02', min: 30, pts: 5 },
      { player_id: 'p1', game_date: '2026-06-01', min: 30, pts: 99 },
    ];
    const result = buildAdjustedPlayers(players, logs, null, 'L5')!;
    expect(result[0].games_played).toBe(5);
    expect(result[0].avg_pts).toBe(5);
  });

  it('skips DNPs (min 0) when building the window', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    const logs = [
      { player_id: 'p1', game_date: '2026-06-04', min: 0, pts: 0 }, // DNP — skipped
      { player_id: 'p1', game_date: '2026-06-02', min: 30, pts: 20 },
    ];
    const result = buildAdjustedPlayers(players, logs, null, 'L5')!;
    expect(result[0].games_played).toBe(1);
    expect(result[0].avg_pts).toBe(20);
  });

  it('falls back to the season list when game logs are missing', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    expect(buildAdjustedPlayers(players, undefined, null, 'L10')).toBe(players);
  });

  it('falls back to the season list when projected has no projections map', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    expect(buildAdjustedPlayers(players, [], null, 'projected')).toBe(players);
  });

  it('projected swaps in the projection and keeps unprojected players at zero', () => {
    const players = [
      makePlayer({ player_id: 'p1', name: 'Projected', avg_pts: 5, games_played: 2 }),
      makePlayer({ player_id: 'p2', name: 'No Projection', avg_pts: 9, games_played: 40 }),
    ];
    const result = buildAdjustedPlayers(players, [], null, 'projected', 'nba', projMap())!;
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Projected'); // identity stays current
    expect(result[0].avg_pts).toBe(24);
    expect(result[0].games_played).toBe(70);
    // Unprojected players stay in the pool (searchable / addable) but show no
    // production the engine never forecast — never their real season line.
    expect(result[1].name).toBe('No Projection');
    expect(result[1].avg_pts).toBe(0);
    expect(result[1].total_pts).toBe(0);
  });
});

// ─── mergeProjectionRow ───────────────────────────────────────────────────────

/** One season-horizon projection row for `p1`, in the view's column shape. */
function projMap(overrides: Record<string, unknown> = {}) {
  return new Map<string, any>([
    [
      'p1',
      {
        player_id: 'p1', projected_games: 70,
        proj_pts: 24, proj_reb: 8, proj_ast: 5, proj_stl: 1.2, proj_blk: 0.6,
        proj_tov: 2.5, proj_fgm: 9, proj_fga: 19, proj_ftm: 4, proj_fta: 5,
        proj_3pm: 2, proj_3pa: 6, proj_min: 34,
        ...overrides,
      },
    ],
  ]);
}

describe('mergeProjectionRow', () => {
  it('rebuilds totals as projection × projected_games so FPTS/G is the projection', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    const r = buildAdjustedPlayers(players, [], null, 'projected', 'nba', projMap())![0];
    expect(r.total_pts).toBe(24 * 70);
    expect(r.total_reb).toBe(8 * 70);
    expect(r.avg_min).toBe(34);
    // total ÷ games_played (what calculateAvgFantasyPoints divides by) is the
    // per-game projection again.
    expect(r.total_ast / r.games_played).toBe(5);
  });

  it('zeroes the stats the model does not project instead of carrying the season line', () => {
    // A mid-season row's real PF/DD/TD counts would otherwise be scored against
    // the projected game count in leagues that weight them.
    const players = [
      makePlayer({ player_id: 'p1', games_played: 60, total_pf: 180, total_dd: 30, total_td: 4, avg_pf: 3 }),
    ];
    const r = buildAdjustedPlayers(players, [], null, 'projected', 'nba', projMap())![0];
    expect(r.total_pf).toBe(0);
    expect(r.avg_pf).toBe(0);
    expect(r.total_dd).toBe(0);
    expect(r.total_td).toBe(0);
  });

  it('treats a missing projected_games as one game so per-game math holds', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    const r = buildAdjustedPlayers(
      players, [], null, 'projected', 'nba', projMap({ projected_games: null }),
    )![0];
    expect(r.games_played).toBe(1);
    expect(r.total_pts).toBe(24);
  });
});

// ─── deriveMinutesUpPlayerIds ─────────────────────────────────────────────────

describe('deriveMinutesUpPlayerIds', () => {
  it('returns undefined when inputs are missing', () => {
    expect(deriveMinutesUpPlayerIds(undefined, [])).toBeUndefined();
    expect(deriveMinutesUpPlayerIds([], undefined)).toBeUndefined();
  });

  it('flags players whose recent minutes exceed 110% of season average', () => {
    const players = [
      makePlayer({ player_id: 'up', avg_min: 20 }), // recent 25 > 22
      makePlayer({ player_id: 'flat', avg_min: 30 }), // recent 30, threshold 33 → no
      makePlayer({ player_id: 'thin', avg_min: 10 }), // only 2 recent games → excluded
    ];
    const logs = [
      { player_id: 'up', min: 25 }, { player_id: 'up', min: 25 }, { player_id: 'up', min: 25 },
      { player_id: 'flat', min: 30 }, { player_id: 'flat', min: 30 }, { player_id: 'flat', min: 30 },
      { player_id: 'thin', min: 40 }, { player_id: 'thin', min: 40 },
    ];
    const set = deriveMinutesUpPlayerIds(logs, players)!;
    expect(set.has('up')).toBe(true);
    expect(set.has('flat')).toBe(false);
    expect(set.has('thin')).toBe(false);
  });

  it('ignores logs with null minutes', () => {
    const players = [makePlayer({ player_id: 'p1', avg_min: 10 })];
    const logs = [
      { player_id: 'p1', min: null },
      { player_id: 'p1', min: 20 }, { player_id: 'p1', min: 20 }, { player_id: 'p1', min: 20 },
    ];
    const set = deriveMinutesUpPlayerIds(logs, players)!;
    expect(set.has('p1')).toBe(true); // 20 avg > 11 threshold, 3 valid games
  });
});
