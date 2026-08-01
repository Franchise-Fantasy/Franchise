import { countStartingSlots, dailySchedule, expectedDailyFpts } from '@/utils/scoring/dailyOutput';

const NBA = dailySchedule('nba', '2026-27')!;
const NFL = dailySchedule('nfl', '2026')!;
/** Coin-flip play rate on a sport that plays every day — round numbers for the
 *  hand-computed cases below. */
const COINFLIP = { playRate: 0.5, slateShare: 1, gamesPerWeek: 3.5 };

describe('dailySchedule', () => {
  it('derives the NBA rate from 82 games over the season calendar', () => {
    // 2026-10-20 → 2027-04-11 is 174 days; 82 / 174 = 0.471 of days.
    expect(NBA.playRate).toBeCloseTo(0.471, 3);
    expect(NBA.slateShare).toBe(1);
    expect(NBA.gamesPerWeek).toBeCloseTo(3.3, 1);
  });

  it('models the NFL as one weekly slate everyone plays in', () => {
    // The distinction that matters: an NFL player is ~certain to play on the
    // slate day, not 14% likely to play on any given day.
    expect(NFL.playRate).toBeCloseTo(0.95, 1);
    expect(NFL.slateShare).toBeCloseTo(1 / 7, 3);
    expect(NFL.gamesPerWeek).toBeCloseTo(1, 1);
  });

  it('returns null for a sport with no schedule model', () => {
    expect(dailySchedule('nhl', '2026-27')).toBeNull();
  });

  it('returns null for a season the tables do not cover', () => {
    expect(dailySchedule('nba', '2099-00')).toBeNull();
  });
});

describe('countStartingSlots', () => {
  const CONFIG = [
    { position: 'PG', slot_count: 1 },
    { position: 'SG', slot_count: 1 },
    { position: 'SF', slot_count: 1 },
    { position: 'PF', slot_count: 1 },
    { position: 'C', slot_count: 1 },
    { position: 'G', slot_count: 1 },
    { position: 'F', slot_count: 1 },
    { position: 'UTIL', slot_count: 2 },
    { position: 'BE', slot_count: 3 },
    { position: 'IR', slot_count: 1 },
  ];

  it('counts starters only — bench, IR and taxi never score', () => {
    expect(countStartingSlots(CONFIG)).toBe(9);
    expect(countStartingSlots([...CONFIG, { position: 'TAXI', slot_count: 3 }])).toBe(9);
  });

  it('returns 0 for a missing config', () => {
    expect(countStartingSlots(undefined)).toBe(0);
  });
});

describe('expectedDailyFpts', () => {
  it('scales a lone player by their play rate', () => {
    expect(expectedDailyFpts([40], 9, COINFLIP)).toBeCloseTo(20, 1);
  });

  it('is zero without seats or a schedule', () => {
    expect(expectedDailyFpts([40, 30], 0, COINFLIP)).toBe(0);
    expect(expectedDailyFpts([40, 30], 9, null)).toBe(0);
  });

  it('ignores players who score nothing', () => {
    expect(expectedDailyFpts([40, 0, 0], 9, COINFLIP)).toBeCloseTo(
      expectedDailyFpts([40], 9, COINFLIP),
      5,
    );
  });

  it('never exceeds the seat limit even when everyone plays', () => {
    // playRate 1 = every player has a game every day, so exactly the best
    // `seats` players score and the rest are stranded on the bench.
    const always = { playRate: 1, slateShare: 1, gamesPerWeek: 7 };
    expect(expectedDailyFpts([50, 40, 30, 20, 10], 3, always)).toBeCloseTo(120, 5);
  });

  it('discounts depth beyond the seat limit rather than counting it in full', () => {
    const five = expectedDailyFpts([20, 20, 20, 20, 20], 3, COINFLIP);
    const three = expectedDailyFpts([20, 20, 20], 3, COINFLIP);
    // The 4th and 5th players are worth something — they cover days when a
    // starter is off — but less than the full 20 x 0.5 a free seat would give.
    expect(five).toBeGreaterThan(three);
    expect(five - three).toBeLessThan(2 * 20 * COINFLIP.playRate);
  });

  it('values the same points more when concentrated in fewer players', () => {
    // Same 200 total FPTS/G, 3 seats: a top-heavy roster starts more of it.
    const topHeavy = expectedDailyFpts([80, 60, 40, 10, 10], 3, COINFLIP);
    const flat = expectedDailyFpts([40, 40, 40, 40, 40], 3, COINFLIP);
    expect(topHeavy).toBeGreaterThan(flat);
  });

  it('matches a hand-computed 3-player, 2-seat case', () => {
    // Players 30/20/10 at rate 0.5, 2 seats. The top two always start when
    // they play. The third is blocked only when BOTH play (p = 0.25):
    //   30(0.5) + 20(0.5) + 10(0.5)(0.75) = 15 + 10 + 3.75 = 28.75 → 28.8
    expect(expectedDailyFpts([30, 20, 10], 2, COINFLIP)).toBeCloseTo(28.8, 1);
  });

  it('is order-independent', () => {
    expect(expectedDailyFpts([10, 30, 20], 2, COINFLIP)).toBeCloseTo(
      expectedDailyFpts([30, 20, 10], 2, COINFLIP),
      5,
    );
  });

  it('spreads an NFL roster over the week without paying for unstartable depth', () => {
    // 16 players, 9 seats, one slate: only the best 9 ever score, and the week
    // spreads that over 7 days. Bench 10-16 add nothing — the trap a naive
    // per-day rate would fall into by counting all 16 at 1/7 each.
    const nine = [30, 28, 26, 24, 22, 20, 18, 16, 14];
    const deep = [...nine, 12, 10, 8, 6, 4, 2, 1];
    const daily = expectedDailyFpts(deep, 9, NFL);
    const startersOnly = expectedDailyFpts(nine, 9, NFL);

    // The seven extra players are worth bye-week cover and nothing more.
    expect(daily).toBeGreaterThan(startersOnly);
    expect(daily).toBeLessThan(startersOnly * 1.05);

    // A naive "each player plays 1/7th of days" rate would count all 16 in
    // full and land ~20% high — the overcount the slate model removes.
    const naive = deep.reduce((a, b) => a + b, 0) * NFL.slateShare * NFL.playRate;
    expect(naive / daily).toBeGreaterThan(1.15);
  });
});
