import { PlayerSeasonStats } from '@/types/player';
import {
  buildAgeTierBreakdown,
  buildCompositeScatter,
  buildRadarData,
  CAT_ORDER,
  compositeZScore,
  computeTeamCategoryAvgs,
  computeTeamZScores,
  getPlayerStatValue,
  type TeamCategoryAvg,
} from '@/utils/scoring/categoryAnalytics';

// Pass raw epoch ms — setSystemTime in this jest version rejects Date instances.
const FIXED_NOW_MS = new Date('2026-06-01T00:00:00Z').getTime();

beforeAll(() => {
  // calculateAge() inside categoryAnalytics needs a deterministic clock.
  jest.useFakeTimers().setSystemTime(FIXED_NOW_MS);
});

afterAll(() => {
  jest.useRealTimers();
});

function makePlayer(overrides: Partial<PlayerSeasonStats & { team_id: string }> = {}): PlayerSeasonStats & { team_id: string } {
  return {
    player_id: 'p1', name: 'Test Player', position: 'PG', pro_team: 'LAL',
    status: 'active', external_id_nba: null, rookie: false,
    season_added: null, draft_year: null, birthdate: '2000-01-01', games_played: 10,
    total_pts: 250, total_reb: 50, total_ast: 50, total_stl: 10, total_blk: 5,
    total_tov: 20, total_fgm: 90, total_fga: 200, total_3pm: 20, total_3pa: 60,
    total_ftm: 50, total_fta: 60, total_pf: 25, total_dd: 0, total_td: 0,
    avg_min: 30, avg_pts: 25, avg_reb: 5, avg_ast: 5, avg_stl: 1, avg_blk: 0.5,
    avg_tov: 2, avg_fgm: 9, avg_fga: 20, avg_3pm: 2, avg_3pa: 6,
    avg_ftm: 5, avg_fta: 6, avg_pf: 2.5,
    team_id: 'team-a',
    ...overrides,
  };
}

describe('computeTeamCategoryAvgs', () => {
  it('excludes players with 0 games played', () => {
    const players = [
      makePlayer({ team_id: 'a', games_played: 0 }),
      makePlayer({ team_id: 'a', games_played: 10 }),
    ];
    const result = computeTeamCategoryAvgs(players);
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe('a');
  });

  it('sums per-game averages for counting stats', () => {
    const players = [
      makePlayer({ team_id: 'a', avg_pts: 20, avg_reb: 8 }),
      makePlayer({ team_id: 'a', avg_pts: 15, avg_reb: 4 }),
    ];
    const result = computeTeamCategoryAvgs(players);
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.averages.PTS).toBe(35);
    expect(a.averages.REB).toBe(12);
  });

  it('computes volume-weighted percentage stats', () => {
    // Two players: 5/10 + 5/10 = 10/20 = 50%
    const players = [
      makePlayer({ team_id: 'a', total_fgm: 5, total_fga: 10 }),
      makePlayer({ team_id: 'a', total_fgm: 5, total_fga: 10 }),
    ];
    const result = computeTeamCategoryAvgs(players);
    expect(result[0].averages['FG%']).toBe(50);
  });
});

describe('buildRadarData', () => {
  function avgs(teamId: string, override: Partial<Record<typeof CAT_ORDER[number], number>>): TeamCategoryAvg {
    const base: Record<string, number> = {};
    for (const c of CAT_ORDER) base[c] = 0;
    return { teamId, averages: { ...base, ...override } as any };
  }

  it('returns null when fewer than 2 teams', () => {
    expect(buildRadarData([avgs('a', { PTS: 100 })], 'a')).toBeNull();
  });

  it('returns null when myTeamId not in list', () => {
    const teamAvgs = [avgs('a', { PTS: 100 }), avgs('b', { PTS: 80 })];
    expect(buildRadarData(teamAvgs, 'c')).toBeNull();
  });

  it('normalizes PTS so the top team is near 1 and bottom near 0', () => {
    const teamAvgs = [avgs('a', { PTS: 120 }), avgs('b', { PTS: 80 })];
    const result = buildRadarData(teamAvgs, 'a')!;
    const pts = result.find((p) => p.cat === 'PTS')!;
    expect(pts.myRaw).toBe(120);
    expect(pts.myNorm).toBe(1);
  });

  it('flips normalization for inverse cats (TO: lower is better)', () => {
    const teamAvgs = [avgs('a', { TO: 5 }), avgs('b', { TO: 15 })];
    const result = buildRadarData(teamAvgs, 'a')!;
    const to = result.find((p) => p.cat === 'TO')!;
    expect(to.inverse).toBe(true);
    expect(to.myNorm).toBe(1); // a has fewer turnovers → norm is "best" (1).
  });
});

describe('computeTeamZScores + compositeZScore', () => {
  function avgs(teamId: string, override: Partial<Record<typeof CAT_ORDER[number], number>>): TeamCategoryAvg {
    const base: Record<string, number> = {};
    for (const c of CAT_ORDER) base[c] = 0;
    return { teamId, averages: { ...base, ...override } as any };
  }

  it('returns [] when myTeamId not in list', () => {
    expect(computeTeamZScores([avgs('a', {})], 'b')).toEqual([]);
  });

  it('z-score of league average team is 0', () => {
    const teamAvgs = [avgs('a', { PTS: 100 }), avgs('b', { PTS: 110 }), avgs('c', { PTS: 90 })];
    const z = computeTeamZScores(teamAvgs, 'a');
    const pts = z.find((s) => s.cat === 'PTS')!;
    expect(pts.zScore).toBe(0);
  });

  it('flips sign for inverse cats (low TO → positive z)', () => {
    const teamAvgs = [avgs('a', { TO: 5 }), avgs('b', { TO: 15 }), avgs('c', { TO: 10 })];
    const z = computeTeamZScores(teamAvgs, 'a');
    const to = z.find((s) => s.cat === 'TO')!;
    expect(to.zScore).toBeGreaterThan(0);
  });

  it('compositeZScore sums all category z-scores', () => {
    const scores = [
      { cat: 'PTS' as const, zScore: 1.5 },
      { cat: 'REB' as const, zScore: -0.5 },
      { cat: 'AST' as const, zScore: 0.25 },
    ];
    expect(compositeZScore(scores)).toBe(1.25);
  });
});

describe('getPlayerStatValue', () => {
  it('returns rounded avg for counting stats', () => {
    const p = makePlayer({ avg_pts: 25.456 });
    expect(getPlayerStatValue(p, 'PTS')).toBe(25.46);
  });

  it('computes percentage stats from totals', () => {
    const p = makePlayer({ total_fgm: 50, total_fga: 100 });
    expect(getPlayerStatValue(p, 'FG%')).toBe(50);
  });

  it('returns 0 when denominator is 0', () => {
    const p = makePlayer({ total_fgm: 0, total_fga: 0 });
    expect(getPlayerStatValue(p, 'FG%')).toBe(0);
  });
});

describe('buildCompositeScatter', () => {
  it('returns [] when fewer than 3 eligible players', () => {
    const players = [makePlayer({ games_played: 10, birthdate: '2000-01-01' })];
    expect(buildCompositeScatter(players)).toEqual([]);
  });

  it('filters out players with no birthdate or < 5 games', () => {
    const players = [
      makePlayer({ player_id: 'a', games_played: 10, birthdate: '2000-01-01' }),
      makePlayer({ player_id: 'b', games_played: 4, birthdate: '2000-01-01' }),  // < 5 games
      makePlayer({ player_id: 'c', games_played: 10, birthdate: null }),         // no birthdate
      makePlayer({ player_id: 'd', games_played: 10, birthdate: '2000-01-01' }),
      makePlayer({ player_id: 'e', games_played: 10, birthdate: '2000-01-01' }),
    ];
    const result = buildCompositeScatter(players);
    expect(result.map((p) => p.playerId).sort()).toEqual(['a', 'd', 'e']);
  });

  it('output has age + composite value for each eligible player', () => {
    const players = [
      makePlayer({ player_id: 'a', games_played: 10, birthdate: '2000-01-01', avg_pts: 30 }),
      makePlayer({ player_id: 'b', games_played: 10, birthdate: '2000-01-01', avg_pts: 15 }),
      makePlayer({ player_id: 'c', games_played: 10, birthdate: '2000-01-01', avg_pts: 5 }),
    ];
    const result = buildCompositeScatter(players);
    expect(result).toHaveLength(3);
    for (const p of result) {
      expect(typeof p.age).toBe('number');
      expect(typeof p.value).toBe('number');
    }
  });
});

describe('buildAgeTierBreakdown', () => {
  it('produces one entry per category', () => {
    const players = [makePlayer({ games_played: 10, birthdate: '2000-01-01' })];
    const result = buildAgeTierBreakdown(players);
    expect(result).toHaveLength(CAT_ORDER.length);
    for (const r of result) expect(CAT_ORDER).toContain(r.cat);
  });

  it('rising/prime/vet percentages sum to ~100 for non-pct stats', () => {
    const players = [
      makePlayer({ player_id: 'a', birthdate: '2004-01-01', games_played: 10, avg_pts: 20 }), // ~22 → rising
      makePlayer({ player_id: 'b', birthdate: '1998-01-01', games_played: 10, avg_pts: 20 }), // ~28 → prime
      makePlayer({ player_id: 'c', birthdate: '1990-01-01', games_played: 10, avg_pts: 20 }), // ~36 → vet
    ];
    const result = buildAgeTierBreakdown(players);
    const pts = result.find((r) => r.cat === 'PTS')!;
    const sum = pts.risingPct + pts.primePct + pts.vetPct;
    expect(Math.round(sum)).toBe(100);
  });
});
