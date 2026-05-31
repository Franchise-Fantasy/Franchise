import {
  computeStrengthOfSchedule,
  type SoSMatchup,
  type SoSTeam,
} from '@/utils/scoring/strengthOfSchedule';

const team = (id: string, w: number, l: number, t = 0): SoSTeam => ({ id, wins: w, losses: l, ties: t });

describe('computeStrengthOfSchedule', () => {
  it('returns one result per team', () => {
    const teams = [team('a', 1, 0), team('b', 0, 1), team('c', 1, 1)];
    const result = computeStrengthOfSchedule([], [], teams);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.teamId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('past SoS = average opponent win%', () => {
    // a played b (win% 0) and c (win% 0.5)
    const teams = [team('a', 2, 0), team('b', 0, 2), team('c', 1, 1)];
    const finalized: SoSMatchup[] = [
      { home_team_id: 'a', away_team_id: 'b' },
      { home_team_id: 'a', away_team_id: 'c' },
    ];
    const result = computeStrengthOfSchedule(finalized, [], teams);
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.pastOpponents).toBe(2);
    expect(a.pastSoS).toBeCloseTo((0 + 0.5) / 2, 5);
  });

  it('futureSoS is null when no remaining opponents', () => {
    const teams = [team('a', 1, 0), team('b', 0, 1)];
    const result = computeStrengthOfSchedule(
      [{ home_team_id: 'a', away_team_id: 'b' }],
      [],
      teams,
    );
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.futureSoS).toBeNull();
    expect(a.futureOpponents).toBe(0);
  });

  it('skips bye-week matchups (away_team_id null)', () => {
    const teams = [team('a', 1, 0), team('b', 0, 1)];
    const result = computeStrengthOfSchedule(
      [{ home_team_id: 'a', away_team_id: null }],
      [],
      teams,
    );
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.pastOpponents).toBe(0);
    expect(a.pastSoS).toBe(0);
  });

  it('overallSoS weights past and future by game count', () => {
    // a faces b (winpct=0) twice in past, c (winpct=1) once in future
    const teams = [team('a', 1, 0), team('b', 0, 1), team('c', 1, 0)];
    const finalized: SoSMatchup[] = [
      { home_team_id: 'a', away_team_id: 'b' },
      { home_team_id: 'a', away_team_id: 'b' },
    ];
    const unfinalized: SoSMatchup[] = [{ home_team_id: 'c', away_team_id: 'a' }];
    const result = computeStrengthOfSchedule(finalized, unfinalized, teams);
    const a = result.find((r) => r.teamId === 'a')!;
    // (0*2 + 1*1) / 3 = 1/3
    expect(a.overallSoS).toBeCloseTo(1 / 3, 5);
  });

  it('treats ties as half-wins in win%', () => {
    // b has 1W-1L-2T → win% = (1 + 0.5*2)/4 = 0.5
    const teams = [team('a', 0, 0), team('b', 1, 1, 2)];
    const result = computeStrengthOfSchedule(
      [{ home_team_id: 'a', away_team_id: 'b' }],
      [],
      teams,
    );
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.pastSoS).toBeCloseTo(0.5, 5);
  });

  it('returns 0 win% for a team with no games played', () => {
    const teams = [team('a', 0, 0), team('b', 0, 0)];
    const result = computeStrengthOfSchedule(
      [{ home_team_id: 'a', away_team_id: 'b' }],
      [],
      teams,
    );
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.pastSoS).toBe(0);
  });
});
