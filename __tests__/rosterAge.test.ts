import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import {
  ageBucket,
  buildLeagueComparison,
  calculateAge,
  calculateRosterAgeProfile,
  getInsightText,
  shortDisplayName,
} from '@/utils/roster/rosterAge';

// Pass raw epoch ms — setSystemTime in this jest version rejects Date instances.
const FIXED_NOW_MS = new Date('2026-06-01T00:00:00Z').getTime();

beforeAll(() => {
  // Fix "now" so calculateAge is deterministic.
  jest.useFakeTimers().setSystemTime(FIXED_NOW_MS);
});

afterAll(() => {
  jest.useRealTimers();
});

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

const WEIGHTS: ScoringWeight[] = [{ stat_name: 'PTS', point_value: 1 }];

describe('shortDisplayName', () => {
  it('returns the last name for typical names', () => {
    expect(shortDisplayName('LeBron James')).toBe('James');
    expect(shortDisplayName('Stephen Curry')).toBe('Curry');
  });

  it('appends Jr/Sr/II/III suffix to preceding last name', () => {
    expect(shortDisplayName('Michael Porter Jr.')).toBe('Porter Jr.');
    expect(shortDisplayName('Larry Nance Jr.')).toBe('Nance Jr.');
    expect(shortDisplayName('Tim Hardaway II')).toBe('Hardaway II');
  });

  it('returns single-token names as-is', () => {
    expect(shortDisplayName('Giannis')).toBe('Giannis');
    expect(shortDisplayName('')).toBe('');
  });
});

describe('calculateAge (clock fixed to 2026-06-01)', () => {
  it('returns whole years when birthday has passed this year', () => {
    // Born 1996-01-15 — turned 30 on Jan 15, 2026; now is June → 30.4 years.
    const age = calculateAge('1996-01-15');
    expect(age).toBeGreaterThan(30);
    expect(age).toBeLessThan(31);
  });

  it('subtracts a year when birthday has not happened yet', () => {
    // Born 1996-08-15 — 30th birthday is Aug 15 2026, today is June → still 29 + fraction.
    const age = calculateAge('1996-08-15');
    expect(age).toBeGreaterThanOrEqual(29);
    expect(age).toBeLessThan(30);
  });

  it('rounds to 1 decimal', () => {
    const age = calculateAge('2000-01-01');
    // expect a single decimal place
    expect(Number((age * 10).toFixed(0)) / 10).toBe(age);
  });
});

describe('ageBucket', () => {
  it('< 25 → rising', () => {
    expect(ageBucket(18)).toBe('rising');
    expect(ageBucket(24.9)).toBe('rising');
  });

  it('25-30 → prime', () => {
    expect(ageBucket(25)).toBe('prime');
    expect(ageBucket(30.9)).toBe('prime');
  });

  it('>= 31 → vet', () => {
    expect(ageBucket(31)).toBe('vet');
    expect(ageBucket(38)).toBe('vet');
  });
});

describe('calculateRosterAgeProfile', () => {
  it('returns zeros when no players have birthdates', () => {
    const profile = calculateRosterAgeProfile([makePlayer()], WEIGHTS);
    expect(profile.avgAge).toBe(0);
    expect(profile.totalWithAge).toBe(0);
  });

  it('groups players into rising/prime/vet correctly', () => {
    const players = [
      makePlayer({ player_id: 'a', birthdate: '2003-06-01', games_played: 10, total_pts: 100 }), // ~23 → rising
      makePlayer({ player_id: 'b', birthdate: '1998-06-01', games_played: 10, total_pts: 100 }), // ~28 → prime
      makePlayer({ player_id: 'c', birthdate: '1990-06-01', games_played: 10, total_pts: 100 }), // ~36 → vet
    ];
    const profile = calculateRosterAgeProfile(players, WEIGHTS);
    expect(profile.totalWithAge).toBe(3);
    expect(profile.risingCount).toBe(1);
    expect(profile.primeCount).toBe(1);
    expect(profile.vetCount).toBe(1);
  });

  it('weightedProductionAge = sum(age × fpts) / sum(fpts)', () => {
    const players = [
      makePlayer({ player_id: 'a', birthdate: '2003-06-01', games_played: 10, total_pts: 200 }), // young, lots of fpts
      makePlayer({ player_id: 'b', birthdate: '1990-06-01', games_played: 10, total_pts: 50 }),  // old, few fpts
    ];
    const profile = calculateRosterAgeProfile(players, WEIGHTS);
    // Weighted age should lean toward the young high-producer.
    expect(profile.weightedProductionAge).toBeLessThan(profile.avgAge);
  });

  it('falls back to avg age when no production signal exists', () => {
    const players = [makePlayer({ birthdate: '2000-01-01', games_played: 0 })];
    const profile = calculateRosterAgeProfile(players, WEIGHTS);
    expect(profile.weightedProductionAge).toBe(profile.avgAge);
  });
});

describe('buildLeagueComparison', () => {
  it('returns null when fewer than 2 teams have data', () => {
    const players = [{ ...makePlayer({ birthdate: '2000-01-01', games_played: 10, total_pts: 100 }), team_id: 'team-a' }];
    expect(buildLeagueComparison(players as any, WEIGHTS, 'team-a')).toBeNull();
  });

  it('ranks my team by weighted age (1 = youngest)', () => {
    const aTeam = [
      { ...makePlayer({ player_id: 'a1', birthdate: '2003-06-01', games_played: 10, total_pts: 200 }), team_id: 'team-a' },
      { ...makePlayer({ player_id: 'a2', birthdate: '2003-06-01', games_played: 10, total_pts: 200 }), team_id: 'team-a' },
      { ...makePlayer({ player_id: 'a3', birthdate: '2003-06-01', games_played: 10, total_pts: 200 }), team_id: 'team-a' },
    ];
    const bTeam = [
      { ...makePlayer({ player_id: 'b1', birthdate: '1990-06-01', games_played: 10, total_pts: 200 }), team_id: 'team-b' },
      { ...makePlayer({ player_id: 'b2', birthdate: '1990-06-01', games_played: 10, total_pts: 200 }), team_id: 'team-b' },
      { ...makePlayer({ player_id: 'b3', birthdate: '1990-06-01', games_played: 10, total_pts: 200 }), team_id: 'team-b' },
    ];
    const comp = buildLeagueComparison([...aTeam, ...bTeam] as any, WEIGHTS, 'team-a');
    expect(comp).not.toBeNull();
    expect(comp!.weightedAgeRank).toBe(1); // team-a (younger) ranks 1st
    expect(comp!.totalTeams).toBe(2);
  });

  // get_league_roster_stats has no ORDER BY, so the same league can come back in
  // a different row order on every fetch. Two teams tied at the same 1dp weighted
  // age must still rank the same way, or the card's "League Position" flips
  // between app opens with no roster change.
  it('ranks tied teams deterministically regardless of input row order', () => {
    const teamPlayers = (teamId: string, prefix: string) => [
      { ...makePlayer({ player_id: `${prefix}1`, birthdate: '1998-06-01', games_played: 10, total_pts: 200 }), team_id: teamId },
      { ...makePlayer({ player_id: `${prefix}2`, birthdate: '1998-06-01', games_played: 10, total_pts: 200 }), team_id: teamId },
      { ...makePlayer({ player_id: `${prefix}3`, birthdate: '1998-06-01', games_played: 10, total_pts: 200 }), team_id: teamId },
    ];
    // Identical rosters → identical weighted age → an exact tie.
    const teamA = teamPlayers('team-a', 'a');
    const teamB = teamPlayers('team-b', 'b');

    const aFirst = buildLeagueComparison([...teamA, ...teamB] as any, WEIGHTS, 'team-a');
    const bFirst = buildLeagueComparison([...teamB, ...teamA] as any, WEIGHTS, 'team-a');

    expect(aFirst!.myProfile.weightedProductionAge).toBe(
      bFirst!.myProfile.weightedProductionAge,
    );
    expect(aFirst!.weightedAgeRank).toBe(bFirst!.weightedAgeRank);
  });
});

describe('getInsightText', () => {
  it('says "Balanced age profile" when no comparison and gap is small', () => {
    const profile = { avgAge: 27, weightedProductionAge: 27.2, risingCount: 0, primeCount: 5, vetCount: 0, totalWithAge: 5 };
    expect(getInsightText(profile)).toContain('Balanced age profile');
  });

  it('includes composition counts when present', () => {
    const profile = { avgAge: 27, weightedProductionAge: 27, risingCount: 2, primeCount: 3, vetCount: 1, totalWithAge: 6 };
    const text = getInsightText(profile);
    expect(text).toContain('prime');
    expect(text).toContain('rising');
    expect(text).toContain('veteran');
  });

  it('says "Youngest roster in league" when ranked 1st', () => {
    const profile = { avgAge: 23, weightedProductionAge: 23, risingCount: 5, primeCount: 0, vetCount: 0, totalWithAge: 5 };
    const text = getInsightText(profile, {
      myProfile: { ...profile, teamId: 'a' },
      leagueAvgWeightedAge: 27,
      leagueAvgRosterAge: 27,
      weightedAgeRank: 1,
      totalTeams: 12,
      allProfiles: [],
    });
    expect(text).toContain('Youngest roster in league');
  });

  it('says "Oldest roster in league" when ranked last', () => {
    const profile = { avgAge: 33, weightedProductionAge: 33, risingCount: 0, primeCount: 0, vetCount: 5, totalWithAge: 5 };
    const text = getInsightText(profile, {
      myProfile: { ...profile, teamId: 'a' },
      leagueAvgWeightedAge: 27,
      leagueAvgRosterAge: 27,
      weightedAgeRank: 12,
      totalTeams: 12,
      allProfiles: [],
    });
    expect(text).toContain('Oldest roster in league');
  });
});
