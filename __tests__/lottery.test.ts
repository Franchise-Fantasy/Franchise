import {
  getPlayoffTeamOptions,
  maxPlayoffWeeksForTeams,
  snapPlayoffTeams,
  defaultPlayoffTeams,
  defaultPlayoffSetup,
  clampLotteryState,
  calcLotteryPoolSize,
  generateDefaultOdds,
  normalizeOdds,
  resizeOdds,
} from '@/utils/league/lottery';

// ─── getPlayoffTeamOptions ──────────────────────────────────────────────────

describe('getPlayoffTeamOptions', () => {
  it('1 playoff week → [2]', () => {
    expect(getPlayoffTeamOptions(1, 10)).toEqual([2]);
  });

  it('2 playoff weeks → [3, 4]', () => {
    expect(getPlayoffTeamOptions(2, 10)).toEqual([3, 4]);
  });

  it('3 playoff weeks → [5, 6, 8]', () => {
    // 4 is excluded — 4 teams only needs 2 rounds (2 weeks), so offering it
    // at 3 weeks would leave a trailing empty playoff week.
    expect(getPlayoffTeamOptions(3, 10)).toEqual([5, 6, 8]);
  });

  it('4 playoff weeks → [10, 12, 16]', () => {
    // 8 excluded — 8 teams only needs 3 rounds (3 weeks).
    expect(getPlayoffTeamOptions(4, 20)).toEqual([10, 12, 16]);
  });

  it('caps options at total team count', () => {
    // 3 weeks, 5 teams → [5] (6 and 8 exceed 5)
    expect(getPlayoffTeamOptions(3, 5)).toEqual([5]);
  });

  it('returns [2] when all options exceed team count', () => {
    expect(getPlayoffTeamOptions(4, 3)).toEqual([2]);
  });

  it('returns [0] when fewer than 2 teams', () => {
    expect(getPlayoffTeamOptions(1, 1)).toEqual([0]);
  });
});

// ─── maxPlayoffWeeksForTeams ────────────────────────────────────────────────

describe('maxPlayoffWeeksForTeams', () => {
  it('2 teams support only a 1-week final', () => {
    expect(maxPlayoffWeeksForTeams(2)).toBe(1);
  });

  it('3-4 teams support 2 weeks', () => {
    expect(maxPlayoffWeeksForTeams(3)).toBe(2);
    expect(maxPlayoffWeeksForTeams(4)).toBe(2);
  });

  it('5-9 teams support 3 weeks (the smallest 4-week bracket needs 10)', () => {
    expect(maxPlayoffWeeksForTeams(5)).toBe(3);
    expect(maxPlayoffWeeksForTeams(9)).toBe(3);
  });

  it('10+ teams support 4 weeks', () => {
    expect(maxPlayoffWeeksForTeams(10)).toBe(4);
    expect(maxPlayoffWeeksForTeams(16)).toBe(4);
  });
});

// ─── snapPlayoffTeams ───────────────────────────────────────────────────────

describe('snapPlayoffTeams', () => {
  it('keeps an already-valid value', () => {
    expect(snapPlayoffTeams(6, 3, 10)).toBe(6);
  });

  it('snaps to the closest valid option', () => {
    // 3 weeks, 10 teams → [5, 6, 8]; desired 7 → 6 (tie 6/8 favors smaller)
    expect(snapPlayoffTeams(7, 3, 10)).toBe(6);
    // 1 week, 2 teams → [2]; a stale 6 collapses to 2
    expect(snapPlayoffTeams(6, 1, 2)).toBe(2);
  });
});

// ─── defaultPlayoffTeams ────────────────────────────────────────────────────

describe('defaultPlayoffTeams', () => {
  it('targets ~60% of the league (6-of-10 convention)', () => {
    expect(defaultPlayoffTeams(3, 10)).toBe(6);
    expect(defaultPlayoffTeams(2, 10)).toBe(4);
  });

  it('caps at team count', () => {
    expect(defaultPlayoffTeams(3, 5)).toBe(5);
  });
});

// ─── defaultPlayoffSetup ────────────────────────────────────────────────────

describe('defaultPlayoffSetup', () => {
  it('10 teams → 6 playoff teams over 3 weeks', () => {
    expect(defaultPlayoffSetup(10, 24)).toEqual({ playoffWeeks: 3, playoffTeams: 6 });
  });

  it('2 teams → a single 1-week final, never more teams than the league has', () => {
    expect(defaultPlayoffSetup(2, 24)).toEqual({ playoffWeeks: 1, playoffTeams: 2 });
  });

  it('4 teams → 3-of-4 bracket over 2 weeks', () => {
    expect(defaultPlayoffSetup(4, 24)).toEqual({ playoffWeeks: 2, playoffTeams: 3 });
  });

  it('caps playoff weeks at half the remaining calendar', () => {
    // Only 4 schedulable weeks left → 2 playoff weeks, not 3.
    expect(defaultPlayoffSetup(10, 4).playoffWeeks).toBe(2);
  });
});

// ─── clampLotteryState ──────────────────────────────────────────────────────

describe('clampLotteryState', () => {
  const base = { teams: 10, playoffWeeks: 3, playoffTeams: 6, lotteryDraws: 4, lotteryOdds: null };

  it('leaves a valid state untouched', () => {
    expect(clampLotteryState(base)).toEqual(base);
  });

  it('snaps an invalid playoffTeams and shrinks lotteryDraws to the pool', () => {
    // 2 teams, 1 week → playoffTeams 2, pool 0 → draws 0
    const clamped = clampLotteryState({ ...base, teams: 2, playoffWeeks: 1 });
    expect(clamped.playoffTeams).toBe(2);
    expect(clamped.lotteryDraws).toBe(0);
  });

  it('resets custom odds whose length no longer matches the pool', () => {
    const clamped = clampLotteryState({ ...base, playoffTeams: 8, lotteryOdds: [50, 30, 20, 0] });
    // playoffTeams 8 valid → pool 2 → 4-entry odds are stale
    expect(clamped.lotteryOdds).toBeNull();
  });
});

// ─── calcLotteryPoolSize ────────────────────────────────────────────────────

describe('calcLotteryPoolSize', () => {
  it('subtracts playoff teams from total', () => {
    expect(calcLotteryPoolSize(12, 8)).toBe(4);
  });

  it('returns 0 when all teams make playoffs', () => {
    expect(calcLotteryPoolSize(8, 8)).toBe(0);
  });

  it('never goes negative', () => {
    expect(calcLotteryPoolSize(4, 8)).toBe(0);
  });
});

// ─── generateDefaultOdds ────────────────────────────────────────────────────

describe('generateDefaultOdds', () => {
  it('returns [100] for 1 team', () => {
    expect(generateDefaultOdds(1)).toEqual([100]);
  });

  it('returns empty array for 0 teams', () => {
    expect(generateDefaultOdds(0)).toEqual([]);
  });

  it('sums to exactly 100', () => {
    for (const n of [2, 3, 4, 5, 6, 8, 10]) {
      const odds = generateDefaultOdds(n);
      const sum = odds.reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 10) / 10).toBe(100);
    }
  });

  it('worst team (index 0) gets highest odds', () => {
    const odds = generateDefaultOdds(5);
    expect(odds[0]).toBeGreaterThan(odds[1]);
    expect(odds[1]).toBeGreaterThan(odds[2]);
  });

  it('each value has at most 1 decimal place', () => {
    const odds = generateDefaultOdds(7);
    for (const o of odds) {
      expect(Math.round(o * 10) / 10).toBe(o);
    }
  });

  it('2 teams: roughly 66.7 / 33.3', () => {
    const odds = generateDefaultOdds(2);
    expect(odds[0]).toBeGreaterThan(odds[1]);
    expect(odds[0] + odds[1]).toBe(100);
  });
});

// ─── normalizeOdds ──────────────────────────────────────────────────────────

describe('normalizeOdds', () => {
  it('returns empty for empty input', () => {
    expect(normalizeOdds([])).toEqual([]);
  });

  it('does not change odds that already sum to 100', () => {
    const odds = [60, 30, 10];
    expect(normalizeOdds(odds)).toEqual([60, 30, 10]);
  });

  it('fixes rounding drift by adjusting first element', () => {
    // These sum to 99.9
    const odds = [33.3, 33.3, 33.3];
    const normalized = normalizeOdds(odds);
    const sum = normalized.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(100);
  });

  it('handles drift above 100', () => {
    const odds = [50.1, 30.1, 20.1];
    const normalized = normalizeOdds(odds);
    const sum = normalized.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(100);
  });
});

// ─── resizeOdds ─────────────────────────────────────────────────────────────

describe('resizeOdds', () => {
  it('returns same array if size unchanged', () => {
    const odds = [60, 30, 10];
    expect(resizeOdds(odds, 3)).toEqual(odds);
  });

  it('regenerates defaults when growing', () => {
    const result = resizeOdds([60, 40], 4);
    expect(result).toHaveLength(4);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it('regenerates defaults when shrinking', () => {
    const result = resizeOdds([40, 30, 20, 10], 2);
    expect(result).toHaveLength(2);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it('returns empty for newSize 0', () => {
    expect(resizeOdds([50, 50], 0)).toEqual([]);
  });

  it('generates defaults from empty array', () => {
    const result = resizeOdds([], 3);
    expect(result).toHaveLength(3);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });
});
