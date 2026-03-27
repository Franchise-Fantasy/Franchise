jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { computeRankings } from '@/hooks/usePlayerRankings';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';

function makePlayer(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    player_id: 'p1', name: 'Test Player', position: 'PG', nba_team: 'LAL',
    status: 'active', external_id_nba: null, rookie: false,
    season_added: null, nba_draft_year: null, birthdate: null, games_played: 0,
    total_pts: 0, total_reb: 0, total_ast: 0, total_stl: 0, total_blk: 0,
    total_tov: 0, total_fgm: 0, total_fga: 0, total_3pm: 0, total_3pa: 0,
    total_ftm: 0, total_fta: 0, total_pf: 0, total_dd: 0, total_td: 0,
    avg_min: 0, avg_pts: 0, avg_reb: 0, avg_ast: 0, avg_stl: 0, avg_blk: 0,
    avg_tov: 0, avg_fgm: 0, avg_fga: 0, avg_3pm: 0, avg_3pa: 0,
    avg_ftm: 0, avg_fta: 0, avg_pf: 0,
    ...overrides,
  };
}

const WEIGHTS: ScoringWeight[] = [
  { stat_name: 'PTS', point_value: 1 },
];

describe('computeRankings', () => {
  it('returns empty map for empty players', () => {
    expect(computeRankings([], WEIGHTS).size).toBe(0);
  });

  it('ranks a single player as #1 overall and #1 at position', () => {
    const players = [makePlayer({ player_id: 'a', position: 'PG', games_played: 10, total_pts: 200 })];
    const map = computeRankings(players, WEIGHTS);
    const r = map.get('a')!;
    expect(r.overallRank).toBe(1);
    expect(r.positionRank).toBe(1);
    expect(r.totalPlayers).toBe(1);
    expect(r.totalAtPosition).toBe(1);
    expect(r.primaryPosition).toBe('PG');
  });

  it('ranks multiple players across positions correctly', () => {
    const players = [
      makePlayer({ player_id: 'a', position: 'PG', games_played: 10, total_pts: 200 }), // 20 avg
      makePlayer({ player_id: 'b', position: 'C', games_played: 10, total_pts: 300 }),  // 30 avg
      makePlayer({ player_id: 'c', position: 'PG', games_played: 10, total_pts: 250 }), // 25 avg
    ];
    const map = computeRankings(players, WEIGHTS);

    expect(map.get('b')!.overallRank).toBe(1);
    expect(map.get('c')!.overallRank).toBe(2);
    expect(map.get('a')!.overallRank).toBe(3);

    // Position ranks
    expect(map.get('b')!.positionRank).toBe(1); // only C
    expect(map.get('b')!.totalAtPosition).toBe(1);
    expect(map.get('c')!.positionRank).toBe(1); // #1 PG
    expect(map.get('a')!.positionRank).toBe(2); // #2 PG
    expect(map.get('a')!.totalAtPosition).toBe(2);
  });

  it('handles tied fpts with standard competition ranking', () => {
    const players = [
      makePlayer({ player_id: 'a', position: 'SF', games_played: 10, total_pts: 200 }), // 20
      makePlayer({ player_id: 'b', position: 'SF', games_played: 10, total_pts: 200 }), // 20
      makePlayer({ player_id: 'c', position: 'SF', games_played: 10, total_pts: 100 }), // 10
    ];
    const map = computeRankings(players, WEIGHTS);

    expect(map.get('a')!.overallRank).toBe(1);
    expect(map.get('b')!.overallRank).toBe(1);
    expect(map.get('c')!.overallRank).toBe(3); // skips 2

    expect(map.get('a')!.positionRank).toBe(1);
    expect(map.get('b')!.positionRank).toBe(1);
    expect(map.get('c')!.positionRank).toBe(3);
  });

  it('uses primary position from multi-position string', () => {
    const players = [
      makePlayer({ player_id: 'a', position: 'SG-SF', games_played: 10, total_pts: 200 }),
    ];
    const map = computeRankings(players, WEIGHTS);
    expect(map.get('a')!.primaryPosition).toBe('SG');
  });
});
