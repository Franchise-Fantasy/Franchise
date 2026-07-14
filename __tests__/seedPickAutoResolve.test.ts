import {
  nextRoundOpponentPool,
  resolvePendingSeedPicks,
  round1OpponentPool,
  roundHasSeedPickChoice,
  type PendingSeedPick,
  type SeedEntry,
} from '@/utils/playoff/seedPickAutoResolve';

// Helpers — teamId encodes the seed so assertions read clearly.
const seed = (n: number): SeedEntry => ({ teamId: `t${n}`, seed: n });
const pick = (n: number, opp: string | null = null): PendingSeedPick => ({
  id: `pick${n}`,
  picking_seed: n,
  picked_opponent_id: opp,
});

describe('roundHasSeedPickChoice', () => {
  it('the final has no choice — two teams, one possible pairing', () => {
    // Regression: Lady Chewers 2026. Round 2 of a 4-team higher_seed_picks
    // bracket created a pick row for the #1 seed whose only legal opponent was
    // the other finalist. The bracket then blocked on "not all picks completed",
    // so neither the championship nor the 3rd-place game was ever written.
    expect(roundHasSeedPickChoice(2)).toBe(false);
  });

  it('a 2-team bracket opening round has no choice', () => {
    expect(roundHasSeedPickChoice(2)).toBe(false);
  });

  it('a 3-team bracket (1 bye, 2 playing) has no choice', () => {
    const seeds = [1, 2, 3].map(seed);
    const playing = seeds.slice(1); // seed 1 gets the bye
    expect(roundHasSeedPickChoice(playing.length)).toBe(false);
  });

  it('semifinals of an 8-team bracket do have a choice', () => {
    expect(roundHasSeedPickChoice(4)).toBe(true);
  });

  it('the opening round of a 4-team bracket has a choice', () => {
    expect(roundHasSeedPickChoice(4)).toBe(true);
  });

  it('agrees with the opponent pool — a choice exists iff the pool has >1 team', () => {
    // The pool is the bottom half of the teams playing, so "more than one
    // opponent to pick from" and "more than two teams playing" must never
    // disagree; if they do, a picker is offered a pool it cannot choose within.
    for (const n of [2, 4, 6, 8]) {
      const winners = Array.from({ length: n }, (_, i) => seed(i + 1));
      const pool = nextRoundOpponentPool(winners);
      expect(roundHasSeedPickChoice(n)).toBe(pool.length > 1);
    }
  });
});

describe('round1OpponentPool', () => {
  it('4 teams, 0 byes → bottom two seeds', () => {
    const seeds = [1, 2, 3, 4].map(seed);
    expect(round1OpponentPool(seeds, 0).map((s) => s.seed)).toEqual([3, 4]);
  });

  it('8 teams, 0 byes → bottom four seeds', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map(seed);
    expect(round1OpponentPool(seeds, 0).map((s) => s.seed)).toEqual([5, 6, 7, 8]);
  });

  it('6 teams (2 byes) → bottom half of the playing seeds only', () => {
    const seeds = [1, 2, 3, 4, 5, 6].map(seed);
    // seeds 1,2 get byes; playing = 3,4,5,6; pool = 5,6
    expect(round1OpponentPool(seeds, 2).map((s) => s.seed)).toEqual([5, 6]);
  });
});

describe('nextRoundOpponentPool', () => {
  it('4 winners → bottom two by seed, regardless of input order', () => {
    const winners = [seed(4), seed(1), seed(3), seed(2)];
    expect(nextRoundOpponentPool(winners).map((s) => s.seed)).toEqual([3, 4]);
  });

  it('2 winners (final) → the single lower seed', () => {
    expect(nextRoundOpponentPool([seed(2), seed(1)]).map((s) => s.seed)).toEqual([2]);
  });
});

describe('resolvePendingSeedPicks', () => {
  it('4-team bracket: best picker gets the weakest opponent (1v4, 2v3)', () => {
    const picks = [pick(1), pick(2)];
    const pool = [seed(3), seed(4)];
    expect(resolvePendingSeedPicks(picks, pool)).toEqual([
      { pickId: 'pick1', opponentId: 't4' },
      { pickId: 'pick2', opponentId: 't3' },
    ]);
  });

  it('is order-independent in both picks and pool', () => {
    const picks = [pick(2), pick(1)];
    const pool = [seed(4), seed(3)];
    expect(resolvePendingSeedPicks(picks, pool)).toEqual([
      { pickId: 'pick1', opponentId: 't4' },
      { pickId: 'pick2', opponentId: 't3' },
    ]);
  });

  it('respects an already-made pick and only assigns the remaining one', () => {
    // seed 1 already chose t3; seed 2 pending; t3 is off the board.
    const picks = [pick(1, 't3'), pick(2)];
    const pool = [seed(3), seed(4)];
    expect(resolvePendingSeedPicks(picks, pool)).toEqual([
      { pickId: 'pick2', opponentId: 't4' },
    ]);
  });

  it('8-team bracket: 1v8, 2v7, 3v6, 4v5', () => {
    const picks = [1, 2, 3, 4].map((n) => pick(n));
    const pool = [5, 6, 7, 8].map(seed);
    expect(resolvePendingSeedPicks(picks, pool)).toEqual([
      { pickId: 'pick1', opponentId: 't8' },
      { pickId: 'pick2', opponentId: 't7' },
      { pickId: 'pick3', opponentId: 't6' },
      { pickId: 'pick4', opponentId: 't5' },
    ]);
  });

  it('returns nothing when every pick is already made', () => {
    const picks = [pick(1, 't4'), pick(2, 't3')];
    expect(resolvePendingSeedPicks(picks, [seed(3), seed(4)])).toEqual([]);
  });

  it('stops when the pool is exhausted (never invents an opponent)', () => {
    const picks = [pick(1), pick(2)];
    const pool = [seed(3)]; // only one opponent for two pickers
    expect(resolvePendingSeedPicks(picks, pool)).toEqual([
      { pickId: 'pick1', opponentId: 't3' },
    ]);
  });

  it('end-to-end with round1OpponentPool for a 6-team bracket (3v6, 4v5)', () => {
    const seeds = [1, 2, 3, 4, 5, 6].map(seed);
    const pool = round1OpponentPool(seeds, 2); // seeds 5,6
    const picks = [pick(3), pick(4)]; // seeds 1,2 have byes; 3,4 pick
    expect(resolvePendingSeedPicks(picks, pool)).toEqual([
      { pickId: 'pick3', opponentId: 't6' },
      { pickId: 'pick4', opponentId: 't5' },
    ]);
  });
});
