import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { buildLeagueStrengthComparison } from '@/utils/roster/rosterStrength';

function makePlayer(
  overrides: Partial<PlayerSeasonStats & { team_id: string; roster_slot: string | null }> = {},
): PlayerSeasonStats & { team_id: string; roster_slot: string | null } {
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
    roster_slot: null,
    ...overrides,
  };
}

// 1 point per point scored; games_played ≥ 10 so current-season avg is used.
const WEIGHTS: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 1 }];

describe('buildLeagueStrengthComparison', () => {
  it('returns null when fewer than 2 teams have data', () => {
    const players = [makePlayer({ team_id: 'team-a', games_played: 10, total_pts: 200 })];
    expect(buildLeagueStrengthComparison(players, WEIGHTS, 'team-a')).toBeNull();
  });

  it('returns null when my team is not in the league set', () => {
    const players = [
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 10, total_pts: 200 }),
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 100 }),
    ];
    expect(buildLeagueStrengthComparison(players, WEIGHTS, 'team-z')).toBeNull();
  });

  it('ranks teams by avg FPTS/G per player descending (1 = strongest)', () => {
    const players = [
      // team-a: (20 + 10) / 2 = 15
      makePlayer({ player_id: 'a1', team_id: 'team-a', games_played: 10, total_pts: 200 }),
      makePlayer({ player_id: 'a2', team_id: 'team-a', games_played: 10, total_pts: 100 }),
      // team-b: 30 / 1 = 30
      makePlayer({ player_id: 'b1', team_id: 'team-b', games_played: 10, total_pts: 300 }),
      // team-c: 5 / 1 = 5
      makePlayer({ player_id: 'c1', team_id: 'team-c', games_played: 10, total_pts: 50 }),
    ];
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a')!;

    expect(result.totalTeams).toBe(3);
    expect(result.myAvgFpts).toBe(15);
    // sorted desc: team-b (30), team-a (15), team-c (5)
    expect(result.allProfiles[0].teamId).toBe('team-b');
    expect(result.allProfiles[2].teamId).toBe('team-c');
    // leagueAvg = (15 + 30 + 5) / 3 = 16.7
    expect(result.leagueAvgFpts).toBeCloseTo(16.7, 1);
    expect(result.myRank).toBe(2);
  });

  it('is independent of active-roster size — depth does not inflate strength', () => {
    const players = [
      // team-a: one elite player, avg 40
      makePlayer({ player_id: 'a1', team_id: 'team-a', games_played: 10, total_pts: 400 }),
      // team-b: same elite player PLUS a weak body. Summing would put team-b
      // ahead (40 + 10 = 50 > 40); averaging keeps team-a ahead (40 > 25).
      makePlayer({ player_id: 'b1', team_id: 'team-b', games_played: 10, total_pts: 400 }),
      makePlayer({ player_id: 'b2', team_id: 'team-b', games_played: 10, total_pts: 100 }),
    ];
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a')!;
    expect(result.myAvgFpts).toBe(40);
    expect(result.allProfiles[1].avgFpts).toBe(25); // team-b dragged down by the weak body
    expect(result.myRank).toBe(1);
  });

  it('clamps negative effective fpts to zero', () => {
    const players = [
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 10, total_pts: -50 }),
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 100 }),
    ];
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a')!;
    expect(result.myAvgFpts).toBe(0);
    expect(result.myRank).toBe(2);
  });

  it('falls back to prev-season fpts below the games threshold', () => {
    const players = [
      // Below MIN_CURRENT_SEASON_GAMES → uses the prev-season map value (25)
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 2, total_pts: 4 }),
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 100 }),
    ];
    const prev = new Map<string, number>([['a', 25]]);
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a', {
      prevSeasonFptsMap: prev,
    })!;
    expect(result.myAvgFpts).toBe(25);
    expect(result.myRank).toBe(1);
  });

  it('uses current-season stats above the supplied games threshold', () => {
    const players = [
      // 6 current games (≥ 5 analytics threshold) → uses current (60 pts → 10/g),
      // ignoring the much higher prev-season fallback.
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 6, total_pts: 60 }),
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 200 }),
    ];
    const prev = new Map<string, number>([['a', 99]]);
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a', {
      prevSeasonFptsMap: prev,
      minGames: 5,
    })!;
    expect(result.myAvgFpts).toBe(10);
    expect(result.myRank).toBe(2);
  });

  it('scores from last-N played games when gameWindow is L5/L10/L15', () => {
    const players = [
      // a's season avg is 10/G (10 games × 10 pts = total 100, /10 = 10)
      // but their last 5 PLAYED games average 30 → window result should be 30
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 10, total_pts: 100 }),
      // b's season avg is 20/G, no game logs → falls back to season
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 200 }),
    ];
    const mk = (pts: number, min = 30) =>
      ({ pts, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, '3pm': 0, '3pa': 0, ftm: 0, fta: 0, pf: 0, min } as any);
    const logs = new Map<string, any[]>([
      ['a', [mk(30), mk(30), mk(30), mk(30), mk(30), mk(10), mk(10)]], // DESC, last 5 = 30 avg
    ]);
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a', {
      gameWindow: 'L5',
      gameLogsByPlayer: logs,
    })!;
    expect(result.myAvgFpts).toBe(30);
    // team-b had no logs, falls back to season avg (20)
    expect(result.allProfiles.find((p) => p.teamId === 'team-b')!.avgFpts).toBe(20);
  });

  it('skips DNPs (min=0) when computing the window', () => {
    const players = [
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 100 }),
    ];
    const mk = (pts: number, min = 30) =>
      ({ pts, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, '3pm': 0, '3pa': 0, ftm: 0, fta: 0, pf: 0, min } as any);
    // Three DNPs followed by 5 played games at 40 pts each. Window should
    // pull from the 5 played games, ignoring the DNPs.
    const logs = new Map<string, any[]>([
      ['a', [mk(0, 0), mk(0, 0), mk(0, 0), mk(40), mk(40), mk(40), mk(40), mk(40)]],
    ]);
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a', {
      gameWindow: 'L5',
      gameLogsByPlayer: logs,
    })!;
    expect(result.myAvgFpts).toBe(40);
  });

  it('excludes IR and TAXI players from the team average', () => {
    const players = [
      makePlayer({ player_id: 'a1', team_id: 'team-a', games_played: 10, total_pts: 200 }), // 20
      makePlayer({ player_id: 'a2', team_id: 'team-a', games_played: 10, total_pts: 300, roster_slot: 'IR' }), // excluded
      makePlayer({ player_id: 'a3', team_id: 'team-a', games_played: 10, total_pts: 150, roster_slot: 'TAXI' }), // excluded
      makePlayer({ player_id: 'b1', team_id: 'team-b', games_played: 10, total_pts: 100 }), // 10
    ];
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a')!;
    // Only the 20-fpts active player counts for team-a, not the IR/TAXI stashes.
    expect(result.myAvgFpts).toBe(20);
    expect(result.myRank).toBe(1);
  });

  it('skips players with no team_id', () => {
    const players = [
      makePlayer({ player_id: 'a', team_id: 'team-a', games_played: 10, total_pts: 200 }),
      makePlayer({ player_id: 'b', team_id: 'team-b', games_played: 10, total_pts: 100 }),
      makePlayer({ player_id: 'c', team_id: '' as any, games_played: 10, total_pts: 999 }),
    ];
    const result = buildLeagueStrengthComparison(players, WEIGHTS, 'team-a')!;
    expect(result.totalTeams).toBe(2);
  });
});
