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

const today = new Date().toISOString().split('T')[0];

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

  it('aggregates game logs within the window for a rolling range', () => {
    const players = [makePlayer({ player_id: 'p1' }), makePlayer({ player_id: 'p2' })];
    const logs = [
      { player_id: 'p1', game_date: today, min: 30, pts: 10, reb: 4, ast: 2 },
      { player_id: 'p1', game_date: today, min: 30, pts: 20, reb: 6, ast: 4 },
      // p2 has no games in the window → dropped
    ];
    const result = buildAdjustedPlayers(players, logs, null, '7d')!;
    expect(result).toHaveLength(1);
    expect(result[0].player_id).toBe('p1');
    expect(result[0].games_played).toBe(2);
    expect(result[0].total_pts).toBe(30);
    expect(result[0].avg_pts).toBe(15); // 30 / 2
    expect(result[0].avg_reb).toBe(5); // 10 / 2
  });

  it('excludes games older than the window', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    const logs = [
      { player_id: 'p1', game_date: today, min: 30, pts: 20 },
      { player_id: 'p1', game_date: '2000-01-01', min: 30, pts: 999 }, // far outside 7d
    ];
    const result = buildAdjustedPlayers(players, logs, null, '7d')!;
    expect(result[0].games_played).toBe(1);
    expect(result[0].total_pts).toBe(20);
  });

  it('falls back to the season list when game logs are missing', () => {
    const players = [makePlayer({ player_id: 'p1' })];
    expect(buildAdjustedPlayers(players, undefined, null, '14d')).toBe(players);
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
