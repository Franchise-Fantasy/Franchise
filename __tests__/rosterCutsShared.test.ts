import {
  computeCutsPlan,
  cutsSortKey,
  type CutsCandidate,
  type CutsPlanConfig,
} from '@/utils/roster/rosterCutsShared';

const SEASON = '2026-27'; // taxi math: experience = 2027 - draft_year

const BASE_CONFIG: CutsPlanConfig = {
  rosterSize: 3,
  taxiSeats: 0,
  taxiMaxExperience: 1, // "Rookies Only"
  currentSeason: SEASON,
};

/** Roster row factory — defaults to a veteran acquired long ago. */
function player(
  id: string,
  overrides: Partial<CutsCandidate> = {},
): CutsCandidate {
  return {
    player_id: id,
    name: `Player ${id}`,
    roster_slot: 'BE',
    acquired_at: '2026-01-01T00:00:00.000Z',
    promoted_from_taxi: false,
    draft_year: 2020,
    rookie_pick_number: null,
    ...overrides,
  };
}

/** A just-drafted rookie: newest timestamp, has a pick number, 1 yr experience. */
function rookie(
  id: string,
  pickNumber: number,
  acquiredAt = '2026-07-20T12:00:00.000Z',
  overrides: Partial<CutsCandidate> = {},
): CutsCandidate {
  return player(id, {
    acquired_at: acquiredAt,
    draft_year: 2026,
    rookie_pick_number: pickNumber,
    ...overrides,
  });
}

const names = (list: CutsCandidate[]) => list.map((p) => p.player_id);

describe('computeCutsPlan — when it does nothing', () => {
  it('returns an empty plan under the cap', () => {
    const plan = computeCutsPlan([player('a'), player('b')], BASE_CONFIG);
    expect(plan).toEqual({
      activeCount: 2,
      rosterSize: 3,
      overBy: 0,
      toTaxi: [],
      toDrop: [],
    });
  });

  it('returns an empty plan exactly at the cap (inclusive)', () => {
    const roster = [player('a'), player('b'), player('c')];
    const plan = computeCutsPlan(roster, BASE_CONFIG);
    expect(plan.overBy).toBe(0);
    expect(plan.toDrop).toHaveLength(0);
  });

  it('ignores IR and TAXI rows when counting the active pool', () => {
    // 3 active + 2 parked = 5 rows, but the cap only governs the 3.
    const roster = [
      player('a'),
      player('b'),
      player('c'),
      player('ir', { roster_slot: 'IR' }),
      player('taxi', { roster_slot: 'TAXI' }),
    ];
    const plan = computeCutsPlan(roster, BASE_CONFIG);
    expect(plan.activeCount).toBe(3);
    expect(plan.overBy).toBe(0);
  });

  it('never selects an IR or TAXI player even when the team is over cap', () => {
    const roster = [
      player('a'),
      player('b'),
      player('c'),
      player('d'),
      player('ir', { roster_slot: 'IR', acquired_at: '2026-07-25T00:00:00.000Z' }),
      player('taxi', { roster_slot: 'TAXI', acquired_at: '2026-07-26T00:00:00.000Z' }),
    ];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, taxiSeats: 5 });
    const touched = [...names(plan.toTaxi), ...names(plan.toDrop)];
    expect(touched).not.toContain('ir');
    expect(touched).not.toContain('taxi');
  });
});

describe('computeCutsPlan — resolution order', () => {
  it('drops exactly overBy players, newest first', () => {
    const roster = [
      player('vet'),
      player('mid', { acquired_at: '2026-03-01T00:00:00.000Z' }),
      rookie('r1', 1, '2026-07-20T12:00:00.000Z'),
      rookie('r2', 2, '2026-07-20T12:05:00.000Z'),
      rookie('r3', 3, '2026-07-20T12:10:00.000Z'),
    ];
    const plan = computeCutsPlan(roster, BASE_CONFIG); // cap 3, no taxi
    expect(plan.overBy).toBe(2);
    expect(plan.toTaxi).toHaveLength(0);
    expect(names(plan.toDrop)).toEqual(['r3', 'r2']);
  });

  it('orders a shared-timestamp offline draft class by pick number, last pick first', () => {
    // apply_offline_draft writes ONE now() for every pick in the transaction,
    // so acquired_at cannot break the tie — pick number must.
    const stamp = '2026-07-20T12:00:00.000Z';
    const roster = [
      player('vet'),
      rookie('r1', 5, stamp),
      rookie('r2', 17, stamp),
      rookie('r3', 29, stamp),
    ];
    const plan = computeCutsPlan(roster, BASE_CONFIG);
    expect(names(plan.toDrop)).toEqual(['r3']);
  });

  it('is deterministic when timestamp and pick number are both tied', () => {
    const stamp = '2026-07-20T12:00:00.000Z';
    const roster = [
      player('vet'),
      player('vet2'),
      player('aaa', { acquired_at: stamp }),
      player('bbb', { acquired_at: stamp }),
    ];
    const first = computeCutsPlan(roster, BASE_CONFIG);
    const second = computeCutsPlan([...roster].reverse(), BASE_CONFIG);
    expect(names(first.toDrop)).toEqual(names(second.toDrop));
  });

  it('orders a purely imported roster by acquired_at alone (no pick numbers)', () => {
    const roster = [
      player('old', { acquired_at: '2025-09-01T00:00:00.000Z' }),
      player('older', { acquired_at: '2025-08-01T00:00:00.000Z' }),
      player('oldest', { acquired_at: '2025-07-01T00:00:00.000Z' }),
      player('newest', { acquired_at: '2025-10-01T00:00:00.000Z' }),
    ];
    const plan = computeCutsPlan(roster, BASE_CONFIG);
    expect(names(plan.toDrop)).toEqual(['newest']);
  });

  it('sorts a row with a pick number ahead of one sharing its timestamp without', () => {
    const stamp = '2026-07-20T12:00:00.000Z';
    const withPick = rookie('r', 12, stamp);
    const withoutPick = player('x', { acquired_at: stamp });
    expect(cutsSortKey(withPick, withoutPick)).toBeLessThan(0);
    expect(cutsSortKey(withoutPick, withPick)).toBeGreaterThan(0);
  });
});

describe('computeCutsPlan — taxi stashing', () => {
  it('stashes instead of dropping when seats are open', () => {
    const roster = [
      player('vet'),
      player('vet2'),
      player('vet3'),
      rookie('r1', 1),
      rookie('r2', 2, '2026-07-20T12:05:00.000Z'),
    ];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, taxiSeats: 2 });
    expect(plan.overBy).toBe(2);
    expect(names(plan.toTaxi)).toEqual(['r2', 'r1']);
    expect(plan.toDrop).toHaveLength(0);
  });

  it('splits: fills the open seats, then drops the remainder', () => {
    const roster = [
      player('vet'),
      rookie('r1', 1, '2026-07-20T12:00:00.000Z'),
      rookie('r2', 2, '2026-07-20T12:05:00.000Z'),
      rookie('r3', 3, '2026-07-20T12:10:00.000Z'),
    ];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, rosterSize: 2, taxiSeats: 1 });
    expect(plan.overBy).toBe(2);
    // Newest goes to the one open seat; next-newest is dropped.
    expect(names(plan.toTaxi)).toEqual(['r3']);
    expect(names(plan.toDrop)).toEqual(['r2']);
  });

  it('counts occupied seats, so a full taxi squad yields an all-drops plan', () => {
    const roster = [
      player('vet'),
      player('parked', { roster_slot: 'TAXI' }),
      rookie('r1', 1),
      rookie('r2', 2, '2026-07-20T12:05:00.000Z'),
    ];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, rosterSize: 1, taxiSeats: 1 });
    expect(plan.toTaxi).toHaveLength(0);
    expect(names(plan.toDrop)).toEqual(['r2', 'r1']);
  });

  it('drops when the league has no taxi seats at all', () => {
    const roster = [player('vet'), rookie('r1', 1), rookie('r2', 2)];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, rosterSize: 2, taxiSeats: 0 });
    expect(plan.toTaxi).toHaveLength(0);
    expect(plan.toDrop).toHaveLength(1);
  });

  it('skips a promoted-from-taxi player and gives the open seat to the next eligible player', () => {
    const roster = [
      player('vet'),
      rookie('promoted', 1, '2026-07-20T12:10:00.000Z', { promoted_from_taxi: true }),
      rookie('fresh', 2, '2026-07-20T12:00:00.000Z'),
    ];
    const plan = computeCutsPlan(roster, {
      ...BASE_CONFIG,
      rosterSize: 2,
      taxiSeats: 3,
    });
    // 'promoted' is newest so it's considered first, but promotion is one-way —
    // it can't return to taxi, so the eligible 'fresh' takes the seat instead.
    expect(names(plan.toTaxi)).toEqual(['fresh']);
    expect(plan.toDrop).toHaveLength(0);
  });

  it('drops an experience-ineligible veteran rather than stashing him', () => {
    const roster = [
      player('vet'),
      // draft_year 2020 → 7 yrs experience, over a "Rookies Only" limit.
      player('grizzled', { acquired_at: '2026-07-20T12:00:00.000Z' }),
    ];
    const plan = computeCutsPlan(roster, {
      ...BASE_CONFIG,
      rosterSize: 1,
      taxiSeats: 3,
    });
    expect(plan.toTaxi).toHaveLength(0);
    expect(names(plan.toDrop)).toEqual(['grizzled']);
  });

  it('honours a wider experience limit', () => {
    const roster = [
      player('vet'),
      player('soph', {
        acquired_at: '2026-07-20T12:00:00.000Z',
        draft_year: 2025, // 2 yrs experience
      }),
    ];
    const tight = computeCutsPlan(roster, { ...BASE_CONFIG, rosterSize: 1, taxiSeats: 3 });
    expect(tight.toTaxi).toHaveLength(0);

    const loose = computeCutsPlan(roster, {
      ...BASE_CONFIG,
      rosterSize: 1,
      taxiSeats: 3,
      taxiMaxExperience: 2,
    });
    expect(names(loose.toTaxi)).toEqual(['soph']);
  });

  it('drops a NULL draft_year player when the league has an experience limit', () => {
    // NFL UDFAs carry no BDL draft year.
    const roster = [
      player('vet'),
      player('udfa', {
        acquired_at: '2026-07-20T12:00:00.000Z',
        draft_year: null,
      }),
    ];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, rosterSize: 1, taxiSeats: 3 });
    expect(plan.toTaxi).toHaveLength(0);
    expect(names(plan.toDrop)).toEqual(['udfa']);
  });

  it('stashes a NULL draft_year player when the league has No Max experience', () => {
    const roster = [
      player('vet'),
      player('udfa', {
        acquired_at: '2026-07-20T12:00:00.000Z',
        draft_year: null,
      }),
    ];
    const plan = computeCutsPlan(roster, {
      ...BASE_CONFIG,
      rosterSize: 1,
      taxiSeats: 3,
      taxiMaxExperience: null,
    });
    expect(names(plan.toTaxi)).toEqual(['udfa']);
    expect(plan.toDrop).toHaveLength(0);
  });

  it('resolves exactly overBy players even with plenty of seats and candidates', () => {
    const roster = [
      player('vet'),
      rookie('r1', 1, '2026-07-20T12:00:00.000Z'),
      rookie('r2', 2, '2026-07-20T12:05:00.000Z'),
      rookie('r3', 3, '2026-07-20T12:10:00.000Z'),
      rookie('r4', 4, '2026-07-20T12:15:00.000Z'),
    ];
    const plan = computeCutsPlan(roster, { ...BASE_CONFIG, taxiSeats: 10 });
    expect(plan.overBy).toBe(2);
    expect(plan.toTaxi).toHaveLength(2);
    expect(plan.toDrop).toHaveLength(0);
  });
});
