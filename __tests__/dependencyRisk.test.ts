import type { LeaguePlayerWithTeam } from '@/hooks/useLeagueRosterStats';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import {
  assignDependencyLevels,
  computeDependencyRisk,
  dependencyTopN,
  type DependencyResult,
} from '@/utils/scoring/dependencyRisk';

function makeResult(teamId: string, topPct: number): DependencyResult {
  return { teamId, topPct, topPlayers: [], totalContributors: 0 };
}

function makePlayer(
  overrides: Partial<PlayerSeasonStats & { team_id: string; name: string; roster_slot: string }> = {},
): LeaguePlayerWithTeam {
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
    team_id: 'team-a',
    ...overrides,
  } as LeaguePlayerWithTeam;
}

const POINTS_WEIGHTS: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 1 }];

describe('computeDependencyRisk — points leagues', () => {
  it('returns empty when no players have a team_id', () => {
    expect(computeDependencyRisk([makePlayer({ team_id: '' })], POINTS_WEIGHTS)).toEqual([]);
  });

  it('reports topPct ≈ 1 when all production comes from 3 players', () => {
    const roster = [
      makePlayer({ player_id: 'a', name: 'A', games_played: 10, total_pts: 300 }),
      makePlayer({ player_id: 'b', name: 'B', games_played: 10, total_pts: 200 }),
      makePlayer({ player_id: 'c', name: 'C', games_played: 10, total_pts: 100 }),
    ];
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS);
    expect(result).toHaveLength(1);
    expect(result[0].topPct).toBe(1);
    expect(result[0].topPlayers).toEqual(['A', 'B', 'C']);
    expect(result[0].totalContributors).toBe(3);
  });

  it('reports < 1 when team has deeper contributors', () => {
    const roster = [
      makePlayer({ player_id: 'a', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'b', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'c', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'd', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'e', games_played: 10, total_pts: 100 }),
    ];
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS);
    expect(result[0].topPct).toBeCloseTo(3 / 5, 5);
  });

  it('weights by games_played (ironman beats few-games elite in top-3 ranking)', () => {
    // Per-game (avg fpts): a1 = 50, a2 = 20, a3 = 20.
    // Weighted by games (season totals): a1 = 250, a2 = 1200, a3 = 1200.
    // So a2/a3 lead the top-3 list, not a1.
    const teamA = [
      makePlayer({ team_id: 'a', name: 'Elite Few Games', player_id: 'a1', games_played: 5, total_pts: 250 }),
      makePlayer({ team_id: 'a', name: 'Ironman A', player_id: 'a2', games_played: 60, total_pts: 1200 }),
      makePlayer({ team_id: 'a', name: 'Ironman B', player_id: 'a3', games_played: 60, total_pts: 1200 }),
    ];
    const result = computeDependencyRisk(teamA, POINTS_WEIGHTS);
    expect(result[0].topPct).toBe(1); // only 3 contributors → whole team
    expect(result[0].topPlayers[0]).not.toBe('Elite Few Games');
    expect(['Ironman A', 'Ironman B']).toContain(result[0].topPlayers[0]);
  });

  it('ranks on prev-season per-game production before the season tips off', () => {
    // NBA 2026-27 pre-tipoff: every games_played is 0, so games-weighting would
    // multiply the whole league out to 0% (the live bug this covers).
    const roster = [
      makePlayer({ team_id: 'a', player_id: 'a1', name: 'Star' }),
      makePlayer({ team_id: 'a', player_id: 'a2', name: 'Role' }),
      makePlayer({ team_id: 'a', player_id: 'a3', name: 'Bench' }),
      makePlayer({ team_id: 'a', player_id: 'a4', name: 'Deep' }),
    ];
    const prev = new Map([['a1', 60], ['a2', 20], ['a3', 10], ['a4', 10]]);
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS, { sport: 'nba', prevSeasonMap: prev });
    expect(result[0].topPct).toBeCloseTo(90 / 100, 5);
    expect(result[0].topPlayers).toEqual(['Star', 'Role', 'Bench']);
  });

  it('still contributes nothing for a mid-season player who has not played', () => {
    // Once the league has games on the board, a prev-season fallback must not
    // resurrect a player who has produced nothing this season.
    const roster = [
      makePlayer({ team_id: 'a', player_id: 'a1', name: 'Playing', games_played: 20, total_pts: 400 }),
      makePlayer({ team_id: 'a', player_id: 'a2', name: 'Injured' }),
    ];
    const prev = new Map([['a2', 50]]);
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS, { sport: 'nba', prevSeasonMap: prev });
    expect(result[0].totalContributors).toBe(1);
    expect(result[0].topPlayers).toEqual(['Playing']);
  });

  it('honours a wider topN and leaves the rest of the roster in the denominator', () => {
    // 6 equal producers, top 4 → 4/6.
    const roster = Array.from({ length: 6 }, (_, i) =>
      makePlayer({ player_id: `p${i}`, name: `P${i}`, games_played: 10, total_pts: 100 }),
    );
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS, { topN: 4 });
    expect(result[0].topPct).toBeCloseTo(4 / 6, 5);
    expect(result[0].topPlayers).toHaveLength(4);
  });

  it('excludes IR and taxi stashes from both the top N and the denominator', () => {
    const roster = [
      makePlayer({ player_id: 'a', name: 'Active', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'b', name: 'Stashed', games_played: 10, total_pts: 900, roster_slot: 'IR' }),
      makePlayer({ player_id: 'c', name: 'Taxi', games_played: 10, total_pts: 900, roster_slot: 'TAXI' }),
    ];
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS);
    expect(result[0].totalContributors).toBe(1);
    expect(result[0].topPlayers).toEqual(['Active']);
  });

  it('returns zero stats for an all-zero roster', () => {
    const roster = [
      makePlayer({ player_id: 'a', games_played: 0, total_pts: 0 }),
      makePlayer({ player_id: 'b', games_played: 0, total_pts: 0 }),
    ];
    const result = computeDependencyRisk(roster, POINTS_WEIGHTS);
    expect(result[0].topPct).toBe(0);
    expect(result[0].topPlayers).toEqual([]);
    expect(result[0].totalContributors).toBe(0);
  });
});

describe('computeDependencyRisk — categories leagues', () => {
  it('uses cat contribution per game instead of fantasy points', () => {
    const roster = [
      makePlayer({ team_id: 'a', player_id: 'a1', games_played: 10, avg_pts: 25, avg_reb: 5, avg_ast: 5 }),
      makePlayer({ team_id: 'a', player_id: 'a2', games_played: 10, avg_pts: 10, avg_reb: 5, avg_ast: 5 }),
      makePlayer({ team_id: 'a', player_id: 'a3', games_played: 10, avg_pts: 10, avg_reb: 5, avg_ast: 5 }),
      makePlayer({ team_id: 'a', player_id: 'a4', games_played: 10, avg_pts: 10, avg_reb: 5, avg_ast: 5 }),
    ];
    const result = computeDependencyRisk(roster, [], { scoringType: 'h2h_categories' });
    expect(result).toHaveLength(1);
    expect(result[0].topPct).toBeGreaterThan(0);
    expect(result[0].topPct).toBeLessThanOrEqual(1);
    expect(result[0].totalContributors).toBe(4);
  });

  it('falls back to last season\'s cat contribution before tip-off', () => {
    // Categories leagues have no fpts to fall back on, so they carry their own
    // prev-season composite map. Without it the whole card reads 0%.
    const roster = [
      makePlayer({ team_id: 'a', player_id: 'a1', name: 'Star' }),
      makePlayer({ team_id: 'a', player_id: 'a2', name: 'Role' }),
      makePlayer({ team_id: 'a', player_id: 'a3', name: 'Bench' }),
      makePlayer({ team_id: 'a', player_id: 'a4', name: 'Deep' }),
    ];
    const prev = new Map([['a1', 45], ['a2', 25], ['a3', 20], ['a4', 10]]);
    const result = computeDependencyRisk(roster, [], {
      scoringType: 'h2h_categories',
      prevSeasonMap: prev,
    });
    expect(result[0].topPct).toBeCloseTo(90 / 100, 5);
    expect(result[0].topPlayers).toEqual(['Star', 'Role', 'Bench']);
  });
});

describe('dependencyTopN', () => {
  it('falls back to 3 when the roster config has not loaded', () => {
    expect(dependencyTopN(undefined)).toBe(3);
    expect(dependencyTopN(0)).toBe(3);
  });

  it('covers a quarter of the active roster', () => {
    expect(dependencyTopN(22)).toBe(6); // NBA dynasty: 10 starters + 12 bench
    expect(dependencyTopN(16)).toBe(4);
  });

  it('clamps to 3–8 so tiny and huge rosters stay readable', () => {
    expect(dependencyTopN(8)).toBe(3);
    expect(dependencyTopN(40)).toBe(8);
  });
});

describe('assignDependencyLevels', () => {
  it('ranks the real WNBA example into a 1 / 2 / 1 spread by top-3 %', () => {
    const levels = assignDependencyLevels([
      makeResult('BOS', 0.48),
      makeResult('LPS', 0.41),
      makeResult('BUS', 0.41),
      makeResult('SPO', 0.39),
    ]);
    expect(levels.get('BOS')).toBe('high');
    expect(levels.get('SPO')).toBe('deep');
    expect(levels.get('LPS')).toBe('moderate');
    expect(levels.get('BUS')).toBe('moderate');
  });

  it('gives equal %s the same color', () => {
    const levels = assignDependencyLevels([
      makeResult('a', 0.60),
      makeResult('b', 0.41),
      makeResult('c', 0.41),
      makeResult('d', 0.30),
    ]);
    // The two 0.41 teams must never split across colors.
    expect(levels.get('b')).toBe(levels.get('c'));
  });

  it('always produces at least one high and one deep (relative, not absolute)', () => {
    // Even when every share is near-balanced, ranking spreads them.
    const levels = assignDependencyLevels([
      makeResult('a', 0.40),
      makeResult('b', 0.42),
      makeResult('c', 0.44),
    ]);
    expect(levels.get('c')).toBe('high');
    expect(levels.get('b')).toBe('moderate');
    expect(levels.get('a')).toBe('deep');
  });

  it('treats zero-production teams as deep and excludes them from the ranking', () => {
    const levels = assignDependencyLevels([
      makeResult('a', 0.70),
      makeResult('b', 0.55),
      makeResult('c', 0.45),
      makeResult('empty', 0),
    ]);
    expect(levels.get('empty')).toBe('deep');
    // Ranking runs over the 3 producing teams only.
    expect(levels.get('a')).toBe('high');
    expect(levels.get('c')).toBe('deep');
  });

  it('does not fabricate risk with fewer than three producing teams', () => {
    const levels = assignDependencyLevels([
      makeResult('a', 0.80),
      makeResult('b', 0.40),
    ]);
    expect(levels.get('a')).toBe('deep');
    expect(levels.get('b')).toBe('deep');
  });
});
