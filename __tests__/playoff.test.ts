import {
  nextPowerOf2,
  calcByes,
  calcRounds,
  seedTeams,
  generateBracketPositions,
  buildStandardRound1,
  buildFixedRound1,
  buildNextRound,
  SeedEntry,
  RoundResult,
} from '@/utils/league/playoff';

// ─── nextPowerOf2 ───────────────────────────────────────────────────────────

describe('nextPowerOf2', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [6, 8],
    [7, 8],
    [8, 8],
    [9, 16],
    [12, 16],
    [16, 16],
  ])('nextPowerOf2(%i) = %i', (input, expected) => {
    expect(nextPowerOf2(input)).toBe(expected);
  });
});

// ─── calcByes ───────────────────────────────────────────────────────────────

describe('calcByes', () => {
  it('0 byes for a perfect power of 2', () => {
    expect(calcByes(8)).toBe(0);
    expect(calcByes(4)).toBe(0);
  });

  it('2 byes for 6 teams', () => {
    expect(calcByes(6)).toBe(2);
  });

  it('3 byes for 5 teams', () => {
    expect(calcByes(5)).toBe(3);
  });

  it('1 bye for 3 teams', () => {
    expect(calcByes(3)).toBe(1);
  });
});

// ─── calcRounds ─────────────────────────────────────────────────────────────

describe('calcRounds', () => {
  it.each([
    [2, 1],
    [4, 2],
    [8, 3],
    [16, 4],
    [6, 3],  // rounds up to 8 → 3
    [5, 3],  // rounds up to 8 → 3
    [3, 2],  // rounds up to 4 → 2
  ])('calcRounds(%i) = %i', (teams, rounds) => {
    expect(calcRounds(teams)).toBe(rounds);
  });
});

// ─── seedTeams ──────────────────────────────────────────────────────────────

describe('seedTeams', () => {
  const standings = [
    { id: 'a', wins: 50, points_for: 1000 },
    { id: 'b', wins: 45, points_for: 950 },
    { id: 'c', wins: 40, points_for: 900 },
    { id: 'd', wins: 35, points_for: 850 },
    { id: 'e', wins: 30, points_for: 800 },
  ];

  it('assigns correct seeds in order', () => {
    const seeds = seedTeams(standings, 4);
    expect(seeds).toEqual([
      { teamId: 'a', seed: 1 },
      { teamId: 'b', seed: 2 },
      { teamId: 'c', seed: 3 },
      { teamId: 'd', seed: 4 },
    ]);
  });

  it('slices to playoffTeams count', () => {
    const seeds = seedTeams(standings, 3);
    expect(seeds).toHaveLength(3);
    expect(seeds[2].teamId).toBe('c');
  });

  it('handles all teams making playoffs', () => {
    const seeds = seedTeams(standings, 5);
    expect(seeds).toHaveLength(5);
  });
});

// ─── generateBracketPositions ───────────────────────────────────────────────

describe('generateBracketPositions', () => {
  it('n=2 → [1, 2]', () => {
    expect(generateBracketPositions(2)).toEqual([1, 2]);
  });

  it('n=4 → [1, 4, 2, 3]', () => {
    expect(generateBracketPositions(4)).toEqual([1, 4, 2, 3]);
  });

  it('n=8 → proper bracket ordering', () => {
    // 1v8, 4v5 feed one semi; 2v7, 3v6 feed the other
    expect(generateBracketPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('all positions appear exactly once', () => {
    const positions = generateBracketPositions(16);
    expect(positions).toHaveLength(16);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});

// ─── buildStandardRound1 ───────────────────────────────────────────────────

describe('buildStandardRound1', () => {
  it('4 teams: no byes, correct matchups', () => {
    const seeds: SeedEntry[] = [
      { teamId: 'a', seed: 1 },
      { teamId: 'b', seed: 2 },
      { teamId: 'c', seed: 3 },
      { teamId: 'd', seed: 4 },
    ];
    const matchups = buildStandardRound1(seeds);
    expect(matchups).toHaveLength(2);
    // 1v4 and 2v3
    const matchup1v4 = matchups.find(m => m.teamA.seed === 1);
    expect(matchup1v4?.teamB?.seed).toBe(4);
    const matchup2v3 = matchups.find(m => m.teamA.seed === 2);
    expect(matchup2v3?.teamB?.seed).toBe(3);
  });

  it('6 teams: 2 byes (seeds 1 and 2)', () => {
    const seeds: SeedEntry[] = Array.from({ length: 6 }, (_, i) => ({
      teamId: String.fromCharCode(97 + i),
      seed: i + 1,
    }));
    const matchups = buildStandardRound1(seeds);
    // 8-slot bracket → 4 matchups, 2 of which are byes
    expect(matchups).toHaveLength(4);

    const byes = matchups.filter(m => m.teamB === null);
    expect(byes).toHaveLength(2);
    // Seeds 1 and 2 should get byes
    const byeSeeds = byes.map(m => m.teamA.seed).sort();
    expect(byeSeeds).toEqual([1, 2]);
  });

  it('higher seed is always teamA', () => {
    const seeds: SeedEntry[] = [
      { teamId: 'a', seed: 1 },
      { teamId: 'b', seed: 2 },
      { teamId: 'c', seed: 3 },
      { teamId: 'd', seed: 4 },
    ];
    const matchups = buildStandardRound1(seeds);
    for (const m of matchups) {
      if (m.teamB) {
        expect(m.teamA.seed).toBeLessThan(m.teamB.seed);
      }
    }
  });
});

// ─── buildFixedRound1 ───────────────────────────────────────────────────────

describe('buildFixedRound1', () => {
  it('produces identical output to buildStandardRound1', () => {
    const seeds: SeedEntry[] = Array.from({ length: 8 }, (_, i) => ({
      teamId: `t${i + 1}`,
      seed: i + 1,
    }));
    expect(buildFixedRound1(seeds)).toEqual(buildStandardRound1(seeds));
  });
});

// ─── buildNextRound ─────────────────────────────────────────────────────────

describe('buildNextRound', () => {
  const r1Results: RoundResult[] = [
    { bracket_position: 1, winner_id: 'a', winner_seed: 1 },
    { bracket_position: 2, winner_id: 'c', winner_seed: 3 },
    { bracket_position: 3, winner_id: 'b', winner_seed: 2 },
    { bracket_position: 4, winner_id: 'e', winner_seed: 5 },
  ];

  it('higher_seed_picks returns null', () => {
    expect(buildNextRound('higher_seed_picks', false, r1Results)).toBeNull();
  });

  it('standard + reseed pairs best vs worst seed', () => {
    const matchups = buildNextRound('standard', true, r1Results)!;
    expect(matchups).toHaveLength(2);
    // After reseed: seeds [1,2,3,5] → 1v5, 2v3
    expect(matchups[0].teamA.seed).toBe(1);
    expect(matchups[0].teamB!.seed).toBe(5);
    expect(matchups[1].teamA.seed).toBe(2);
    expect(matchups[1].teamB!.seed).toBe(3);
  });

  it('fixed (no reseed) feeds adjacent bracket positions forward', () => {
    const matchups = buildNextRound('fixed', false, r1Results)!;
    expect(matchups).toHaveLength(2);
    // Positions 1+2 face each other, positions 3+4 face each other
    expect(matchups[0].teamA.teamId).toBe('a');
    expect(matchups[0].teamB!.teamId).toBe('c');
    expect(matchups[1].teamA.teamId).toBe('b');
    expect(matchups[1].teamB!.teamId).toBe('e');
  });

  it('standard + no reseed also feeds adjacent positions forward', () => {
    const matchups = buildNextRound('standard', false, r1Results)!;
    expect(matchups).toHaveLength(2);
    // Same as fixed: positions 1+2, 3+4
    expect(matchups[0].teamA.teamId).toBe('a');
    expect(matchups[0].teamB!.teamId).toBe('c');
    expect(matchups[1].teamA.teamId).toBe('b');
    expect(matchups[1].teamB!.teamId).toBe('e');
  });
});
