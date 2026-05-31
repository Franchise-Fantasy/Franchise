import {
  computeAllPlayRecords,
  type MatchupRow,
  type ScoringCategory,
  type TeamRecord,
} from '@/utils/scoring/allPlayRecord';

describe('computeAllPlayRecords — points leagues', () => {
  it('returns [] when matchups or teams are empty', () => {
    expect(computeAllPlayRecords([], [{ id: 'a', wins: 0, losses: 0, ties: 0 }])).toEqual([]);
    expect(computeAllPlayRecords([{ week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 0, away_score: 0, winner_team_id: null }], [])).toEqual([]);
  });

  it('top scorer beats everyone, lowest scorer loses to everyone', () => {
    const teams: TeamRecord[] = [
      { id: 'a', wins: 1, losses: 0, ties: 0 },
      { id: 'b', wins: 0, losses: 1, ties: 0 },
      { id: 'c', wins: 0, losses: 1, ties: 0 },
      { id: 'd', wins: 1, losses: 0, ties: 0 },
    ];
    // Week 1: a=120, b=80 → a wins H2H. c=110, d=70 → c wins H2H.
    // All-play: a beats b,c,d (3-0); b loses to a,c (0-2)+beats d (1) = 1-2; c beats b,d, loses to a = 2-1; d loses all = 0-3.
    const matchups: MatchupRow[] = [
      { week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 120, away_score: 80, winner_team_id: 'a' },
      { week_number: 1, home_team_id: 'c', away_team_id: 'd', home_score: 110, away_score: 70, winner_team_id: 'c' },
    ];
    const result = computeAllPlayRecords(matchups, teams);
    const a = result.find((r) => r.teamId === 'a')!;
    const d = result.find((r) => r.teamId === 'd')!;
    expect(a.allPlayWins).toBe(3);
    expect(a.allPlayLosses).toBe(0);
    expect(a.allPlayWinPct).toBe(1);
    expect(d.allPlayWins).toBe(0);
    expect(d.allPlayLosses).toBe(3);
    expect(d.allPlayWinPct).toBe(0);
  });

  it('ranks each team correctly within the week', () => {
    const teams: TeamRecord[] = [
      { id: 'a', wins: 0, losses: 0, ties: 0 },
      { id: 'b', wins: 0, losses: 0, ties: 0 },
      { id: 'c', wins: 0, losses: 0, ties: 0 },
    ];
    const matchups: MatchupRow[] = [
      { week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 100, away_score: 90, winner_team_id: 'a' },
      { week_number: 1, home_team_id: 'c', away_team_id: null, home_score: 110, away_score: 0, winner_team_id: 'c' },
    ];
    const result = computeAllPlayRecords(matchups, teams);
    const aWeek = result.find((r) => r.teamId === 'a')!.weeklyBreakdown[0];
    const cWeek = result.find((r) => r.teamId === 'c')!.weeklyBreakdown[0];
    expect(cWeek.rankAmongAll).toBe(1);
    expect(aWeek.rankAmongAll).toBe(2);
  });

  it('ties contribute 0.5 in all-play win%', () => {
    const teams: TeamRecord[] = [
      { id: 'a', wins: 0, losses: 0, ties: 1 },
      { id: 'b', wins: 0, losses: 0, ties: 1 },
    ];
    const matchups: MatchupRow[] = [
      { week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 100, away_score: 100, winner_team_id: null },
    ];
    const result = computeAllPlayRecords(matchups, teams);
    const a = result.find((r) => r.teamId === 'a')!;
    expect(a.allPlayTies).toBe(1);
    expect(a.allPlayWinPct).toBe(0.5);
  });

  it('luckIndex = actualWins − expectedWins', () => {
    // 2 weeks. Team a wins both H2H but is always 2nd in points → unlucky-no, lucky.
    const teams: TeamRecord[] = [
      { id: 'a', wins: 2, losses: 0, ties: 0 },
      { id: 'b', wins: 0, losses: 2, ties: 0 },
      { id: 'c', wins: 0, losses: 0, ties: 0 },
    ];
    const matchups: MatchupRow[] = [
      // a beats b H2H but c scores highest
      { week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 100, away_score: 90, winner_team_id: 'a' },
      { week_number: 1, home_team_id: 'c', away_team_id: null, home_score: 120, away_score: 0, winner_team_id: 'c' },
      { week_number: 2, home_team_id: 'a', away_team_id: 'b', home_score: 100, away_score: 90, winner_team_id: 'a' },
      { week_number: 2, home_team_id: 'c', away_team_id: null, home_score: 120, away_score: 0, winner_team_id: 'c' },
    ];
    const result = computeAllPlayRecords(matchups, teams);
    const a = result.find((r) => r.teamId === 'a')!;
    // a's all-play winPct < 1 (always loses to c), but actual wins = 2 → positive luck.
    expect(a.luckIndex).toBeGreaterThan(0);
  });
});

describe('computeAllPlayRecords — categories leagues', () => {
  const categories: ScoringCategory[] = [
    { stat_name: 'PTS' },
    { stat_name: 'REB' },
    { stat_name: 'AST' },
    { stat_name: 'TO', inverse: true },
  ];

  it('simulates per-category matchups using category_results stats', () => {
    const teams: TeamRecord[] = [
      { id: 'a', wins: 1, losses: 0, ties: 0 },
      { id: 'b', wins: 0, losses: 1, ties: 0 },
    ];
    const matchups: MatchupRow[] = [
      {
        week_number: 1,
        home_team_id: 'a',
        away_team_id: 'b',
        home_score: 0,
        away_score: 0,
        winner_team_id: 'a',
        category_results: [
          { stat: 'PTS', home: 600, away: 500, winner: 'home' },
          { stat: 'REB', home: 200, away: 180, winner: 'home' },
          { stat: 'AST', home: 100, away: 150, winner: 'away' },
          { stat: 'TO', home: 30, away: 50, winner: 'home' },
        ],
      },
    ];
    const result = computeAllPlayRecords(matchups, teams, 'h2h_categories', categories);
    const a = result.find((r) => r.teamId === 'a')!;
    const b = result.find((r) => r.teamId === 'b')!;
    expect(a.allPlayWins).toBe(1);
    expect(a.allPlayLosses).toBe(0);
    expect(b.allPlayWins).toBe(0);
    expect(b.allPlayLosses).toBe(1);
  });

  it('falls back to points logic when h2h_categories but no categories provided', () => {
    const teams: TeamRecord[] = [
      { id: 'a', wins: 0, losses: 0, ties: 0 },
      { id: 'b', wins: 0, losses: 0, ties: 0 },
    ];
    const matchups: MatchupRow[] = [
      { week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 100, away_score: 80, winner_team_id: 'a' },
    ];
    const result = computeAllPlayRecords(matchups, teams, 'h2h_categories', []);
    const a = result.find((r) => r.teamId === 'a')!;
    // Empty categories array → falls back to points scoring; a > b → 1-0.
    expect(a.allPlayWins).toBe(1);
  });

  it('skips matchups missing category_results', () => {
    const teams: TeamRecord[] = [
      { id: 'a', wins: 0, losses: 0, ties: 0 },
      { id: 'b', wins: 0, losses: 0, ties: 0 },
    ];
    const matchups: MatchupRow[] = [
      { week_number: 1, home_team_id: 'a', away_team_id: 'b', home_score: 0, away_score: 0, winner_team_id: null /* no category_results */ },
    ];
    const result = computeAllPlayRecords(matchups, teams, 'h2h_categories', categories);
    expect(result.every((r) => r.allPlayWins + r.allPlayLosses + r.allPlayTies === 0)).toBe(true);
  });
});
