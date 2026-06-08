import { computePlayoffStatuses } from '@/utils/league/playoffStatuses';
import { type TeamStanding } from '@/utils/league/standingsResolve';

const TIEBREAKERS = ['head_to_head', 'points_for'];

function team(
  id: string,
  wins: number,
  losses: number,
  pointsFor = 0,
): TeamStanding & { rank: number } {
  return {
    id,
    name: id,
    tricode: null,
    logo_key: null,
    wins,
    losses,
    ties: 0,
    points_for: pointsFor,
    points_against: 0,
    streak: '',
    division: null,
    rank: 0,
  };
}

/** Assign ranks 1..N in array order (caller passes already-sorted standings). */
function ranked(
  teams: (TeamStanding & { rank: number })[],
): (TeamStanding & { rank: number })[] {
  return teams.map((t, i) => ({ ...t, rank: i + 1 }));
}

describe('computePlayoffStatuses', () => {
  it('returns no badges before any game is played (pre-draft / pre-week-1)', () => {
    // Regression: a brand-new league (all 0-0-0, empty remainingGames) used to
    // flag the first N teams "clinched" and the rest "eliminated".
    const standings = ranked(
      Array.from({ length: 10 }, (_, i) => team(`t${i}`, 0, 0)),
    );
    const statuses = computePlayoffStatuses(
      standings,
      new Map(), // no scheduled matchups yet
      6,
      [],
      TIEBREAKERS,
    );
    expect(statuses.size).toBe(0);
  });

  it('still computes clinch/elimination once the season is under way', () => {
    // 2 playoff spots. One dominant team, one buried team, with games remaining.
    const standings = ranked([
      team('lead', 13, 1, 1500),
      team('mid1', 7, 7, 1200),
      team('mid2', 7, 7, 1100),
      team('tail', 1, 13, 900),
    ]);
    const remaining = new Map([
      ['lead', 0],
      ['mid1', 0],
      ['mid2', 0],
      ['tail', 0],
    ]);
    const statuses = computePlayoffStatuses(standings, remaining, 2, [], TIEBREAKERS);
    expect(statuses.get('lead')).toBe('clinched');
    expect(statuses.get('tail')).toBe('eliminated');
  });

  it('returns no badges when playoffTeams is degenerate (<=0 or >= team count)', () => {
    const standings = ranked([team('a', 5, 1), team('b', 1, 5)]);
    const remaining = new Map([
      ['a', 0],
      ['b', 0],
    ]);
    expect(computePlayoffStatuses(standings, remaining, 0, [], TIEBREAKERS).size).toBe(0);
    expect(computePlayoffStatuses(standings, remaining, 2, [], TIEBREAKERS).size).toBe(0);
  });
});
