import {
  formatMinuteOfDay,
  formatQuietWindow,
  isQuietNow,
  type QuietHoursConfig,
} from '@/utils/draft/quietHours';

// A standard overnight window: freeze 3:00 AM ET, resume 8:00 AM ET.
const OVERNIGHT: QuietHoursConfig = {
  quiet_hours_enabled: true,
  quiet_hours_start_min: 180, // 3:00 AM
  quiet_hours_end_min: 480, // 8:00 AM
};

describe('isQuietNow — same-day window (3am–8am ET)', () => {
  // 2026-07-15 is EDT (UTC-4): 08:00Z = 04:00 ET → inside.
  it('is quiet mid-window (4am ET, EDT)', () => {
    expect(isQuietNow(OVERNIGHT, new Date('2026-07-15T08:00:00Z'))).toBe(true);
  });

  it('is live at exactly the resume edge (half-open, 8:00 ET)', () => {
    // 12:00Z = 08:00 EDT — window is [start, end), so the resume minute is live.
    expect(isQuietNow(OVERNIGHT, new Date('2026-07-15T12:00:00Z'))).toBe(false);
  });

  it('is quiet at exactly the freeze edge (3:00 ET)', () => {
    // 07:00Z = 03:00 EDT.
    expect(isQuietNow(OVERNIGHT, new Date('2026-07-15T07:00:00Z'))).toBe(true);
  });

  it('is live outside the window (10am ET)', () => {
    // 14:00Z = 10:00 EDT.
    expect(isQuietNow(OVERNIGHT, new Date('2026-07-15T14:00:00Z'))).toBe(false);
  });

  it('measures the window in ET, not UTC (DST guard)', () => {
    // 02:00Z on 2026-07-15 is 22:00 (10pm) ET the PREVIOUS evening — a naive
    // UTC reading (02:00 = minute 120) would wrongly report quiet.
    expect(isQuietNow(OVERNIGHT, new Date('2026-07-15T02:00:00Z'))).toBe(false);
  });

  it('handles EST (winter) offset correctly', () => {
    // 2026-01-15 is EST (UTC-5): 08:00Z = 03:00 ET → at the freeze edge, quiet.
    expect(isQuietNow(OVERNIGHT, new Date('2026-01-15T08:00:00Z'))).toBe(true);
    // 13:00Z = 08:00 EST → resume edge, live.
    expect(isQuietNow(OVERNIGHT, new Date('2026-01-15T13:00:00Z'))).toBe(false);
  });
});

describe('isQuietNow — window that wraps past midnight (11pm–6am ET)', () => {
  const WRAP: QuietHoursConfig = {
    quiet_hours_enabled: true,
    quiet_hours_start_min: 1380, // 11:00 PM
    quiet_hours_end_min: 360, // 6:00 AM
  };

  it('is quiet after the start, before midnight (11:30pm ET)', () => {
    // 03:30Z = 23:30 EDT.
    expect(isQuietNow(WRAP, new Date('2026-07-16T03:30:00Z'))).toBe(true);
  });

  it('is quiet after midnight, before the end (2am ET)', () => {
    // 06:00Z = 02:00 EDT.
    expect(isQuietNow(WRAP, new Date('2026-07-16T06:00:00Z'))).toBe(true);
  });

  it('is live in the daytime gap (8am ET)', () => {
    // 12:00Z = 08:00 EDT.
    expect(isQuietNow(WRAP, new Date('2026-07-16T12:00:00Z'))).toBe(false);
  });
});

describe('isQuietNow — disabled / misconfigured', () => {
  const at = new Date('2026-07-15T08:00:00Z'); // 4am ET, would be quiet if enabled

  it('is never quiet when disabled', () => {
    expect(isQuietNow({ ...OVERNIGHT, quiet_hours_enabled: false }, at)).toBe(false);
  });

  it('is never quiet with a null edge', () => {
    expect(isQuietNow({ quiet_hours_enabled: true, quiet_hours_start_min: 180, quiet_hours_end_min: null }, at)).toBe(false);
  });

  it('is never quiet when start === end (zero-length window)', () => {
    expect(isQuietNow({ quiet_hours_enabled: true, quiet_hours_start_min: 180, quiet_hours_end_min: 180 }, at)).toBe(false);
  });

  it('tolerates a bare/empty config', () => {
    expect(isQuietNow({}, at)).toBe(false);
  });
});

describe('formatMinuteOfDay', () => {
  it.each([
    [0, '12:00 AM'],
    [90, '1:30 AM'],
    [180, '3:00 AM'],
    [480, '8:00 AM'],
    [720, '12:00 PM'],
    [780, '1:00 PM'],
    [1380, '11:00 PM'],
    [1439, '11:59 PM'],
  ])('formats %i as %s', (min, expected) => {
    expect(formatMinuteOfDay(min)).toBe(expected);
  });
});

describe('formatQuietWindow', () => {
  it('summarizes an enabled window with an ET suffix', () => {
    expect(formatQuietWindow(OVERNIGHT)).toBe('3:00 AM – 8:00 AM ET');
  });

  it('returns null when disabled or misconfigured', () => {
    expect(formatQuietWindow({ ...OVERNIGHT, quiet_hours_enabled: false })).toBeNull();
    expect(formatQuietWindow({ quiet_hours_enabled: true, quiet_hours_start_min: null, quiet_hours_end_min: 480 })).toBeNull();
  });
});
