import {
  addSlateDays,
  getSportTimezone,
  getSportToday,
  getSportTomorrow,
  nextSlateRollover,
  sportSlateDate,
  week1EndDate,
  week1Length,
} from '@/utils/leagueTime';

describe('getSportTimezone', () => {
  it('returns America/New_York for supported sports', () => {
    expect(getSportTimezone('nba')).toBe('America/New_York');
    expect(getSportTimezone('wnba')).toBe('America/New_York');
    expect(getSportTimezone('nfl')).toBe('America/New_York');
    expect(getSportTimezone('mlb')).toBe('America/New_York');
    expect(getSportTimezone('nhl')).toBe('America/New_York');
  });

  it('falls back to NBA TZ for unknown sport', () => {
    expect(getSportTimezone('xyz')).toBe('America/New_York');
    expect(getSportTimezone(null)).toBe('America/New_York');
    expect(getSportTimezone(undefined)).toBe('America/New_York');
  });
});

describe('sportSlateDate (5am ET rollover)', () => {
  it('rolls back to prior day before 5am ET', () => {
    // 2026-02-15 04:00 ET (EST) === 2026-02-15 09:00 UTC
    const at = new Date('2026-02-15T09:00:00Z');
    expect(sportSlateDate('nba', at)).toBe('2026-02-14');
  });

  it('uses today after 5am ET', () => {
    // 2026-02-15 05:00 ET === 2026-02-15 10:00 UTC
    const at = new Date('2026-02-15T10:00:00Z');
    expect(sportSlateDate('nba', at)).toBe('2026-02-15');
  });

  it('groups a late-night East Coast game past midnight with the prior slate', () => {
    // 2026-02-15 01:30 ET (still on the 14th slate) === 2026-02-15 06:30 UTC
    const at = new Date('2026-02-15T06:30:00Z');
    expect(sportSlateDate('nba', at)).toBe('2026-02-14');
  });

  it('handles month boundary correctly', () => {
    // 2026-03-01 02:00 ET → still 2026-02-28 slate
    const at = new Date('2026-03-01T07:00:00Z');
    expect(sportSlateDate('nba', at)).toBe('2026-02-28');
  });

  it('handles year boundary correctly', () => {
    // 2027-01-01 03:00 ET → 2026-12-31 slate
    const at = new Date('2027-01-01T08:00:00Z');
    expect(sportSlateDate('nba', at)).toBe('2026-12-31');
  });
});

describe('getSportToday / getSportTomorrow', () => {
  it('tomorrow is one calendar day after today', () => {
    const at = new Date('2026-02-15T18:00:00Z');
    const today = getSportToday('nba', at);
    const tomorrow = getSportTomorrow('nba', at);
    expect(today).toBe('2026-02-15');
    expect(tomorrow).toBe('2026-02-16');
  });

  it('tomorrow correctly advances across month boundary', () => {
    const at = new Date('2026-02-28T18:00:00Z');
    expect(getSportTomorrow('nba', at)).toBe('2026-03-01');
  });
});

describe('nextSlateRollover', () => {
  it('targets today at 5am ET when called before 5am ET', () => {
    const at = new Date('2026-02-15T08:00:00Z'); // 03:00 ET on 02-15
    const rollover = nextSlateRollover('nba', at);
    // 5am EST on 2026-02-15 = 10:00 UTC
    expect(rollover.toISOString()).toBe('2026-02-15T10:00:00.000Z');
  });

  it('targets tomorrow at 5am ET when already past 5am today', () => {
    const at = new Date('2026-02-15T15:00:00Z'); // 10:00 ET on 02-15
    const rollover = nextSlateRollover('nba', at);
    expect(rollover.toISOString()).toBe('2026-02-16T10:00:00.000Z');
  });

  it('uses 09:00 UTC during EDT (daylight saving)', () => {
    // 2026-06-15 12:00 UTC = 08:00 EDT → next rollover is 06-16 05:00 EDT = 06-16 09:00 UTC
    const at = new Date('2026-06-15T12:00:00Z');
    const rollover = nextSlateRollover('nba', at);
    expect(rollover.toISOString()).toBe('2026-06-16T09:00:00.000Z');
  });
});

describe('addSlateDays', () => {
  it('adds positive days', () => {
    expect(addSlateDays('2026-02-15', 1)).toBe('2026-02-16');
    expect(addSlateDays('2026-02-15', 7)).toBe('2026-02-22');
  });

  it('subtracts negative days', () => {
    expect(addSlateDays('2026-02-15', -1)).toBe('2026-02-14');
    expect(addSlateDays('2026-02-15', -7)).toBe('2026-02-08');
  });

  it('handles month + year boundaries', () => {
    expect(addSlateDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addSlateDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addSlateDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('does not drift across DST boundaries (UTC-anchored)', () => {
    // March DST spring-forward
    expect(addSlateDays('2026-03-07', 1)).toBe('2026-03-08');
    // November fall-back
    expect(addSlateDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('returning 0 days yields the same date', () => {
    expect(addSlateDays('2026-02-15', 0)).toBe('2026-02-15');
  });
});

describe('week1Length', () => {
  // dow: 0=Sun, 1=Mon, ..., 6=Sat
  it('produces short 5-7 day Week 1 for Mon/Tue/Wed starts', () => {
    expect(week1Length(1)).toBe(7); // Mon → Mon-Sun
    expect(week1Length(2)).toBe(6); // Tue
    expect(week1Length(3)).toBe(5); // Wed
  });

  it('produces long 8-11 day Week 1 for Thu/Fri/Sat/Sun starts', () => {
    expect(week1Length(4)).toBe(11); // Thu → Thu through second Sun
    expect(week1Length(5)).toBe(10); // Fri
    expect(week1Length(6)).toBe(9);  // Sat
    expect(week1Length(0)).toBe(8);  // Sun
  });
});

describe('week1EndDate', () => {
  // June 2026: 06-01 Mon, 06-04 Thu, 06-08 Mon, 06-14 Sun
  it('returns the first Sunday for a Wed start', () => {
    expect(week1EndDate('2026-06-03')).toBe('2026-06-07'); // Wed → Sun (5 days)
  });

  it('returns the second Sunday for a Thu start', () => {
    expect(week1EndDate('2026-06-04')).toBe('2026-06-14'); // Thu → Sun (11 days)
  });

  it('returns the second Sunday for a Sun start', () => {
    expect(week1EndDate('2026-06-07')).toBe('2026-06-14'); // Sun → next Sun (8 days)
  });

  it('returns the first Sunday for a Mon start', () => {
    expect(week1EndDate('2026-06-01')).toBe('2026-06-07'); // Mon → Sun (7 days)
  });
});

describe('week1Length — Monday-ending weeks (NFL, weekEndDow=1)', () => {
  it('produces short 5-7 day Week 1 for Tue/Wed/Thu starts', () => {
    expect(week1Length(2, 1)).toBe(7); // Tue → Tue-Mon
    expect(week1Length(3, 1)).toBe(6); // Wed (2026 kickoff)
    expect(week1Length(4, 1)).toBe(5); // Thu
  });

  it('produces long 8-11 day Week 1 for Fri/Sat/Sun/Mon starts', () => {
    expect(week1Length(5, 1)).toBe(11); // Fri → Fri through second Mon
    expect(week1Length(6, 1)).toBe(10); // Sat
    expect(week1Length(0, 1)).toBe(9);  // Sun
    expect(week1Length(1, 1)).toBe(8);  // Mon
  });

  it('defaults to the Sunday-ending table when weekEndDow is omitted', () => {
    for (let dow = 0; dow <= 6; dow++) {
      expect(week1Length(dow)).toBe(week1Length(dow, 0));
    }
  });
});

describe('week1EndDate — Monday-ending weeks (NFL)', () => {
  it('ends the 2026 kickoff week (Wed Sep 9 start) on Monday Sep 14', () => {
    expect(week1EndDate('2026-09-09', 1)).toBe('2026-09-14'); // Wed → Mon (6 days)
  });

  it('returns the second Monday for a Friday start', () => {
    expect(week1EndDate('2026-09-11', 1)).toBe('2026-09-21'); // Fri → 2nd Mon (11 days)
  });
});
