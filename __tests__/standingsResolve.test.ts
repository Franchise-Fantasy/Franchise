import { resolveStandings, type TeamStanding } from '@/utils/league/standingsResolve';
import { type MatchupRow } from '@/utils/scoring/allPlayRecord';

// Minimal TeamStanding builder — name defaults to id, records default to 0.
function team(o: Partial<TeamStanding> & { id: string }): TeamStanding {
  return {
    name: o.id,
    tricode: null,
    logo_key: null,
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    streak: '',
    division: null,
    ...o,
  };
}

function matchup(home: string, away: string, winner: string, week = 1): MatchupRow {
  return {
    week_number: week,
    home_team_id: home,
    away_team_id: away,
    home_score: 0,
    away_score: 0,
    winner_team_id: winner,
  };
}

const ORDER = ['head_to_head', 'points_for'];

// ─── win-pct ordering ─────────────────────────────────────────────────────────

describe('resolveStandings — win percentage', () => {
  it('returns [] for no teams', () => {
    expect(resolveStandings([], [], ORDER)).toEqual([]);
  });

  it('orders by win pct descending and assigns 1-based ranks', () => {
    const teams = [
      team({ id: 'c', wins: 5, losses: 5 }), // .500
      team({ id: 'a', wins: 8, losses: 2 }), // .800
      team({ id: 'b', wins: 6, losses: 4 }), // .600
    ];
    const result = resolveStandings(teams, [], ORDER);
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(result.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it('counts ties as half a win', () => {
    const teams = [
      team({ id: 'lo', wins: 0, losses: 1 }), // .000
      team({ id: 'hi', wins: 1, losses: 0 }), // 1.000
      team({ id: 'mid', wins: 0, losses: 0, ties: 2 }), // (0 + 1) / 2 = .500
    ];
    expect(resolveStandings(teams, [], ORDER).map((t) => t.id)).toEqual(['hi', 'mid', 'lo']);
  });
});

// ─── tiebreakers ────────────────────────────────────────────────────────────

describe('resolveStandings — tiebreakers within an equal-win-pct group', () => {
  it('breaks ties by head-to-head wins', () => {
    // Same record + same points_for, so only H2H separates them.
    const teams = [
      team({ id: 'A', wins: 5, losses: 5, points_for: 100 }),
      team({ id: 'B', wins: 5, losses: 5, points_for: 100 }),
    ];
    const matchups = [matchup('A', 'B', 'A')]; // A beat B
    expect(resolveStandings(teams, matchups, ['head_to_head']).map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('falls through to points_for when head-to-head is even', () => {
    const teams = [
      team({ id: 'A', wins: 5, losses: 5, points_for: 100 }),
      team({ id: 'B', wins: 5, losses: 5, points_for: 200 }),
    ];
    // No matchups → H2H is 0-0 → cmp 0 → falls to points_for, B higher.
    expect(resolveStandings(teams, [], ORDER).map((t) => t.id)).toEqual(['B', 'A']);
  });

  it('respects tiebreaker priority: head_to_head outranks points_for', () => {
    const teams = [
      team({ id: 'A', wins: 5, losses: 5, points_for: 100 }), // fewer points
      team({ id: 'B', wins: 5, losses: 5, points_for: 200 }), // more points
    ];
    const matchups = [matchup('A', 'B', 'A')]; // but A won head-to-head

    // H2H first → A wins the tiebreak despite fewer points.
    expect(resolveStandings(teams, matchups, ['head_to_head', 'points_for']).map((t) => t.id)).toEqual(['A', 'B']);
    // points_for first → B wins.
    expect(resolveStandings(teams, matchups, ['points_for']).map((t) => t.id)).toEqual(['B', 'A']);
  });

  it('does not reorder teams in different win-pct groups by tiebreaker', () => {
    // B has more points_for but a worse record — must still rank below A.
    const teams = [
      team({ id: 'A', wins: 8, losses: 2, points_for: 100 }),
      team({ id: 'B', wins: 2, losses: 8, points_for: 999 }),
    ];
    expect(resolveStandings(teams, [], ORDER).map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('ignores byes and unfinished matchups in H2H (null away/winner)', () => {
    const teams = [
      team({ id: 'A', wins: 5, losses: 5, points_for: 100 }),
      team({ id: 'B', wins: 5, losses: 5, points_for: 100 }),
    ];
    const matchups: MatchupRow[] = [
      { week_number: 1, home_team_id: 'A', away_team_id: null, home_score: 0, away_score: 0, winner_team_id: null },
      matchup('B', 'A', 'B'), // the only decided game: B beat A
    ];
    expect(resolveStandings(teams, matchups, ['head_to_head']).map((t) => t.id)).toEqual(['B', 'A']);
  });
});
