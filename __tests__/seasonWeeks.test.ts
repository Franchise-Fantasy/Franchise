import {
  applyCupWeekToggle,
  computeMaxWeeks,
  defaultSeasonStart,
  deriveTradeDeadlineDate,
  deriveTradeDeadlineWeek,
  regularSeasonWeekEndDates,
  tradeDeadlineDateForWeek,
  weekNumberForDate,
} from '@/utils/league/seasonWeeks';

describe('computeMaxWeeks', () => {
  // NBA 2025-26: opens Tue 2025-10-21, ends Sun 2026-04-12. Hardcoded merge
  // windows: All-Star 2026-02-09..22 (mandatory), Cup 2025-12-08..21 (optional).
  const start = new Date(2025, 9, 21); // Tue Oct 21, 2025

  it('counts Mon-Sun weeks from opening night to the season end (All-Star double week included)', () => {
    // Week 1 Tue-Sun (6 days), the Feb 9-15 week absorbs the All-Star window
    // (one matchup spanning two calendar weeks), last week ends exactly Apr 12.
    expect(computeMaxWeeks('2025-26', 'nba', start)).toBe(24);
  });

  it('drops one week when the optional NBA Cup window is included', () => {
    // The Dec 8-14 week extends through Dec 21 — one matchup where two fit
    // before, so one fewer week fits before the season end.
    expect(computeMaxWeeks('2025-26', 'nba', start, true)).toBe(23);
  });

  it('Cup toggle is a no-op for a season starting after the Cup window', () => {
    const january = new Date(2026, 0, 5); // Mon Jan 5, 2026 — past the knockouts
    expect(computeMaxWeeks('2025-26', 'nba', january, true)).toBe(
      computeMaxWeeks('2025-26', 'nba', january, false),
    );
  });
});

describe('applyCupWeekToggle', () => {
  // NBA 2025-26 from opening night: maxTotal = 24 without the Cup window,
  // 23 with it. Base state sits exactly at the no-Cup max (21 + 3).
  const base = {
    sport: 'nba' as const,
    season: '2025-26',
    seasonStartDate: '2025-10-21',
    regularSeasonWeeks: 21,
    playoffWeeks: 3,
    tradeDeadlineWeek: 17,
    combineCupWeek: false,
  };

  it('turning the double week on gives up one regular-season week when at max', () => {
    const next = applyCupWeekToggle({ ...base, combineCupWeek: true }, base);
    expect(next.regularSeasonWeeks).toBe(20);
    expect(next.playoffWeeks).toBe(3);
  });

  it('turning it back off restores the freed week', () => {
    const on = { ...base, combineCupWeek: true, regularSeasonWeeks: 20 };
    const next = applyCupWeekToggle({ ...on, combineCupWeek: false }, on);
    expect(next.regularSeasonWeeks).toBe(21);
  });

  it('leaves a deliberately short season alone', () => {
    const short = { ...base, regularSeasonWeeks: 10 };
    const next = applyCupWeekToggle({ ...short, combineCupWeek: true }, short);
    expect(next.regularSeasonWeeks).toBe(10);
  });

  it('is a no-op when the season starts after the Cup window', () => {
    const jan = { ...base, seasonStartDate: '2026-01-05', regularSeasonWeeks: 12 };
    const next = applyCupWeekToggle({ ...jan, combineCupWeek: true }, jan);
    expect(next).toEqual({ ...jan, combineCupWeek: true });
  });
});

describe('regularSeasonWeekEndDates / tradeDeadlineDateForWeek / weekNumberForDate', () => {
  // Plain Monday start with no merge windows nearby — a clean baseline for
  // the week↔date round-trip before layering in the All-Star double week.
  const plainStart = new Date(2025, 10, 3); // Mon Nov 3, 2025

  it('produces sequential Mon-Sun weeks with no merge windows involved', () => {
    const weeks = regularSeasonWeekEndDates('nba', '2025-26', plainStart, 4, false);
    expect(weeks.map((w) => w.endDate)).toEqual([
      '2025-11-09',
      '2025-11-16',
      '2025-11-23',
      '2025-11-30',
    ]);
  });

  it('tradeDeadlineDateForWeek clamps into [1, regularSeasonWeeks]', () => {
    expect(tradeDeadlineDateForWeek('nba', '2025-26', plainStart, 4, 2, false)).toBe('2025-11-16');
    expect(tradeDeadlineDateForWeek('nba', '2025-26', plainStart, 4, 0, false)).toBe('2025-11-09');
    expect(tradeDeadlineDateForWeek('nba', '2025-26', plainStart, 4, 100, false)).toBe('2025-11-30');
  });

  it('weekNumberForDate finds the week whose window contains a date, clamping out-of-range dates', () => {
    const weeks = regularSeasonWeekEndDates('nba', '2025-26', plainStart, 4, false);
    expect(weekNumberForDate(weeks, '2025-11-16')).toBe(2); // exact week-end match
    expect(weekNumberForDate(weeks, '2025-11-12')).toBe(2); // mid-week
    expect(weekNumberForDate(weeks, '2025-10-01')).toBe(1); // before the season — clamps to first
    expect(weekNumberForDate(weeks, '2025-12-25')).toBe(4); // past the last week — clamps to last
  });

  // NBA 2025-26 opening-night fixture from the computeMaxWeeks tests above:
  // the mandatory All-Star break (2026-02-09..22) merges what would be week 17
  // into a double week. This is exactly the case the naive `week1End + 7*(N-1)`
  // math (replaced by this function) got wrong.
  const openingNight = new Date(2025, 9, 21); // Tue Oct 21, 2025

  it('absorbs the mandatory All-Star window into the overlapping week, not a plain 7-day step', () => {
    const weeks = regularSeasonWeekEndDates('nba', '2025-26', openingNight, 17, false);
    expect(weeks).toHaveLength(17);
    // Naive math would land week 17 on 2026-02-15 (Feb 9 + 6 days); the real
    // matchup runs through the All-Star break to 2026-02-22.
    expect(weeks[16].endDate).toBe('2026-02-22');
  });

  it('agrees with computeMaxWeeks on the season-end date for the full 24-week slate', () => {
    // computeMaxWeeks asserts 24 weeks fit with the last ending exactly on the
    // season end (2026-04-12) — cross-check the two functions stay in sync.
    expect(computeMaxWeeks('2025-26', 'nba', openingNight)).toBe(24);
    const weeks = regularSeasonWeekEndDates('nba', '2025-26', openingNight, 24, false);
    expect(weeks[23].endDate).toBe('2026-04-12');
  });

  it('a deadline date inside the merged double week resolves back to that week number', () => {
    const weeks = regularSeasonWeekEndDates('nba', '2025-26', openingNight, 17, false);
    expect(weekNumberForDate(weeks, '2026-02-10')).toBe(17);
    expect(tradeDeadlineDateForWeek('nba', '2025-26', openingNight, 17, 17, false)).toBe('2026-02-22');
  });
});

describe('deriveTradeDeadlineDate / deriveTradeDeadlineWeek (week↔date lockstep)', () => {
  // NBA 2025-26 opening night — carries the mandatory All-Star double week at
  // week 17, so the round-trip is exercised across a merge window, not just
  // clean 7-day steps.
  const base = {
    sport: 'nba' as const,
    season: '2025-26',
    seasonStartDate: '2025-10-21',
    regularSeasonWeeks: 20,
    combineCupWeek: false,
  };

  it('week → date returns that week’s end date', () => {
    expect(deriveTradeDeadlineDate({ ...base, tradeDeadlineWeek: 17 })).toBe('2026-02-22');
  });

  it('date → week returns the containing week number', () => {
    // A date inside the merged All-Star double week resolves to week 17.
    expect(deriveTradeDeadlineWeek({ ...base, tradeDeadlineDate: '2026-02-10' })).toBe(17);
  });

  it('round-trips: every week maps to a date that maps back to the same week', () => {
    for (let week = 1; week <= base.regularSeasonWeeks; week++) {
      const date = deriveTradeDeadlineDate({ ...base, tradeDeadlineWeek: week });
      expect(date).not.toBeNull();
      expect(deriveTradeDeadlineWeek({ ...base, tradeDeadlineDate: date })).toBe(week);
    }
  });

  it('a custom mid-week date snaps to its containing week, whose end date it then becomes', () => {
    // Fine-tune to Wed Nov 5 — inside week 3 (Tue Oct 21 opener → wk1 Oct 21-26,
    // wk2 Oct 27-Nov 2, wk3 Nov 3-9). Nudging the week stepper then collapses
    // the date onto that week's Sunday end. This is the "never different"
    // lockstep the two controls guarantee.
    const week = deriveTradeDeadlineWeek({ ...base, tradeDeadlineDate: '2025-11-05' });
    expect(week).toBe(3);
    expect(deriveTradeDeadlineDate({ ...base, tradeDeadlineWeek: week })).toBe('2025-11-09');
  });

  it('treats week 0 / null date as "no deadline"', () => {
    expect(deriveTradeDeadlineDate({ ...base, tradeDeadlineWeek: 0 })).toBeNull();
    expect(deriveTradeDeadlineWeek({ ...base, tradeDeadlineDate: null })).toBe(0);
  });

  it('falls back to the default season start when none is set', () => {
    // No seasonStartDate → defaultSeasonStart drives the week math; still a
    // valid, non-null derivation rather than a crash.
    expect(deriveTradeDeadlineDate({ ...base, seasonStartDate: null, tradeDeadlineWeek: 1 })).not.toBeNull();
  });
});

describe('defaultSeasonStart', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('floors at opening night when the pro season has not tipped off', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-02T16:00:00Z'));
    const d = defaultSeasonStart('nba', '2026-27');
    // NBA 2026-27 opens 2026-10-20 — a July-created league can't start earlier.
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 20]);
  });

  it('falls back to tomorrow once the season is underway', () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-15T17:00:00Z')); // noon ET
    const d = defaultSeasonStart('nba', '2026-27');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2027, 1, 16]);
  });
});
