import { planScheduleWeeks, schedulableEnd, type MergeWindow } from '@/utils/league/scheduleWindows';

// All anchor dates are real 2026 weekdays. 2026-01-01 is a Thursday, so the
// Mondays used below check out: Jan 5, Feb 2, Mar 2, Aug 10/17/24 are Mondays.

describe('planScheduleWeeks — no merge windows (regression)', () => {
  it('matches plain Week-1 + Mon–Sun stepping for a Monday start', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-01-05', // Monday
      regularSeasonWeeks: 4,
      playoffWeeks: 2,
      mergeWindows: [],
    });
    expect(weeks).toEqual([
      { weekNumber: 1, startDate: '2026-01-05', endDate: '2026-01-11', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 2, startDate: '2026-01-12', endDate: '2026-01-18', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 3, startDate: '2026-01-19', endDate: '2026-01-25', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 4, startDate: '2026-01-26', endDate: '2026-02-01', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 5, startDate: '2026-02-02', endDate: '2026-02-08', isPlayoff: true, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 6, startDate: '2026-02-09', endDate: '2026-02-15', isPlayoff: true, isDoubleWeek: false, mergeLabel: undefined },
    ]);
  });

  it('gives a Thu start an 11-day Week 1 ending the second Sunday', () => {
    const [week1] = planScheduleWeeks({
      seasonStart: '2026-02-12', // Thursday
      regularSeasonWeeks: 1,
      playoffWeeks: 0,
      mergeWindows: [],
    });
    expect(week1.startDate).toBe('2026-02-12');
    expect(week1.endDate).toBe('2026-02-22'); // 11 days, second Sunday
    expect(week1.isDoubleWeek).toBe(false);
  });
});

describe('planScheduleWeeks — All-Star double week', () => {
  const allStar: MergeWindow = { start: '2026-02-09', end: '2026-02-22', label: 'All-Star Break' };

  it('collapses the straddling weeks into one 14-day matchup, preserving count', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-02-02', // Monday
      regularSeasonWeeks: 3,
      playoffWeeks: 0,
      mergeWindows: [allStar],
    });
    expect(weeks.length).toBe(3); // matchup count preserved
    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3]); // contiguous

    expect(weeks[0]).toMatchObject({ startDate: '2026-02-02', endDate: '2026-02-08', isDoubleWeek: false });
    // Week 2 absorbs the break: Feb 9 base week extends to the window end Feb 22.
    expect(weeks[1]).toMatchObject({
      startDate: '2026-02-09',
      endDate: '2026-02-22',
      isDoubleWeek: true,
      mergeLabel: 'All-Star Break',
    });
    // Calendar extends: week 3 lands the week AFTER the merged span.
    expect(weeks[2]).toMatchObject({ startDate: '2026-02-23', endDate: '2026-03-01', isDoubleWeek: false });
  });

  it('is a no-op when the season starts after the window', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-03-02', // Monday, after the All-Star window
      regularSeasonWeeks: 2,
      playoffWeeks: 0,
      mergeWindows: [allStar],
    });
    expect(weeks.every((w) => !w.isDoubleWeek)).toBe(true);
    expect(weeks[0]).toMatchObject({ startDate: '2026-03-02', endDate: '2026-03-08' });
    expect(weeks[1]).toMatchObject({ startDate: '2026-03-09', endDate: '2026-03-15' });
  });
});

describe('planScheduleWeeks — WNBA FIBA bridge', () => {
  // Window starts Aug 31 — the Monday AFTER the last full game-week (Aug 24–30) —
  // so that week stays a normal matchup; the empty weeks (Aug 31–Sep 16) + the
  // post-break games (Sep 17–24) collapse into one bridged matchup.
  const fiba: MergeWindow = { start: '2026-08-31', end: '2026-09-24', label: 'FIBA World Cup Break' };

  it('keeps the last full week normal and bridges only the dead zone + tail', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-08-10', // Monday
      regularSeasonWeeks: 4,
      playoffWeeks: 0,
      mergeWindows: [fiba],
    });
    expect(weeks[0]).toMatchObject({ startDate: '2026-08-10', endDate: '2026-08-16', isDoubleWeek: false });
    expect(weeks[1]).toMatchObject({ startDate: '2026-08-17', endDate: '2026-08-23', isDoubleWeek: false });
    // The last full game-week before the break stays a normal matchup.
    expect(weeks[2]).toMatchObject({ startDate: '2026-08-24', endDate: '2026-08-30', isDoubleWeek: false });
    // The empty weeks + post-break games collapse into one bridged matchup.
    expect(weeks[3]).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-09-24',
      isDoubleWeek: true,
      mergeLabel: 'FIBA World Cup Break',
    });
  });
});

describe('schedulableEnd — terminal break walls off the season', () => {
  it('returns the day before a terminal window (WNBA FIBA ends the season early)', () => {
    expect(
      schedulableEnd('2026-09-24', [
        { start: '2026-07-20', end: '2026-08-02', label: 'All-Star Break' },
        { start: '2026-08-31', end: '2026-09-24', label: 'FIBA World Cup Break', terminal: true },
      ]),
    ).toBe('2026-08-30');
  });

  it('falls back to season end when no window is terminal (NBA)', () => {
    expect(
      schedulableEnd('2026-04-12', [{ start: '2026-02-09', end: '2026-02-22', label: 'All-Star Break' }]),
    ).toBe('2026-04-12');
  });

  it('ignores a terminal window that starts after the season end', () => {
    expect(
      schedulableEnd('2026-08-15', [{ start: '2026-08-31', end: '2026-09-24', terminal: true }]),
    ).toBe('2026-08-15');
  });
});

describe('planScheduleWeeks — NFL Monday-ending weeks (weekEndDow=1)', () => {
  it('plans the real 2026 season: Wed Sep 9 kickoff → 6-day Week 1, then Tue–Mon', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-09-09', // Wednesday (2026 kickoff per BDL)
      regularSeasonWeeks: 3,
      playoffWeeks: 1,
      mergeWindows: [],
      weekEndDow: 1,
    });
    expect(weeks).toEqual([
      { weekNumber: 1, startDate: '2026-09-09', endDate: '2026-09-14', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 2, startDate: '2026-09-15', endDate: '2026-09-21', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 3, startDate: '2026-09-22', endDate: '2026-09-28', isPlayoff: false, isDoubleWeek: false, mergeLabel: undefined },
      { weekNumber: 4, startDate: '2026-09-29', endDate: '2026-10-05', isPlayoff: true, isDoubleWeek: false, mergeLabel: undefined },
    ]);
  });

  it('gives a Friday start an 11-day Week 1 ending the second Monday', () => {
    const [week1] = planScheduleWeeks({
      seasonStart: '2026-09-11', // Friday
      regularSeasonWeeks: 1,
      playoffWeeks: 0,
      mergeWindows: [],
      weekEndDow: 1,
    });
    expect(week1.startDate).toBe('2026-09-11');
    expect(week1.endDate).toBe('2026-09-21'); // 11 days, second Monday
  });

  it('weekEndDow: 0 is byte-identical to omitting it (NBA/WNBA regression)', () => {
    // Seven consecutive start days — every day-of-week — must plan identically.
    for (let offset = 0; offset < 7; offset++) {
      const seasonStart = `2026-01-${String(5 + offset).padStart(2, '0')}`;
      const opts = { seasonStart, regularSeasonWeeks: 4, playoffWeeks: 2, mergeWindows: [] };
      expect(planScheduleWeeks({ ...opts, weekEndDow: 0 })).toEqual(planScheduleWeeks(opts));
    }
  });
});

describe('planScheduleWeeks — contract details', () => {
  it('marks regular vs playoff weeks by index', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-01-05',
      regularSeasonWeeks: 2,
      playoffWeeks: 2,
      mergeWindows: [],
    });
    expect(weeks.map((w) => w.isPlayoff)).toEqual([false, false, true, true]);
  });

  it('merges any window passed to it — optional filtering is the caller’s job', () => {
    const weeks = planScheduleWeeks({
      seasonStart: '2026-02-02',
      regularSeasonWeeks: 2,
      playoffWeeks: 0,
      mergeWindows: [{ start: '2026-02-09', end: '2026-02-22', label: 'NBA Cup Knockouts', optional: true }],
    });
    expect(weeks[1].isDoubleWeek).toBe(true);
    expect(weeks[1].endDate).toBe('2026-02-22');
  });
});
