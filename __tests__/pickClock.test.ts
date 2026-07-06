import {
  formatClockRemaining,
  formatPickClock,
  isSlowClock,
  MAX_PICK_SECONDS,
  pickDeadlineMs,
  reminderLeadSeconds,
  SLOW_PICK_MIN_SECONDS,
  SLOW_PICK_OPTIONS,
} from '../utils/draft/pickClock';

describe('isSlowClock', () => {
  it('treats the 30-minute threshold as slow', () => {
    expect(isSlowClock(SLOW_PICK_MIN_SECONDS)).toBe(true);
    expect(isSlowClock(SLOW_PICK_MIN_SECONDS - 1)).toBe(false);
    expect(isSlowClock(86400)).toBe(true);
  });

  it('handles null/undefined (drafts without a snapshot)', () => {
    expect(isSlowClock(null)).toBe(false);
    expect(isSlowClock(undefined)).toBe(false);
  });
});

describe('formatPickClock', () => {
  it('formats live-draft second values', () => {
    expect(formatPickClock(45)).toBe('45s');
    expect(formatPickClock(90)).toBe('1m 30s');
    expect(formatPickClock(120)).toBe('2 min');
    expect(formatPickClock(300)).toBe('5 min');
  });

  it('formats every slow option to its chip label duration', () => {
    const labels = SLOW_PICK_OPTIONS.map((o) => formatPickClock(o.seconds));
    expect(labels).toEqual(['30 min', '1 hr', '2 hrs', '4 hrs', '8 hrs', '12 hrs', '1 day']);
  });

  it('falls back to compound form for non-round values', () => {
    expect(formatPickClock(5400)).toBe('1h 30m');
    expect(formatPickClock(90000)).toBe('1d 1h');
  });
});

describe('formatClockRemaining', () => {
  it('keeps MM:SS under an hour', () => {
    expect(formatClockRemaining(0)).toBe('00:00');
    expect(formatClockRemaining(-500)).toBe('00:00');
    expect(formatClockRemaining(59_000)).toBe('00:59');
    expect(formatClockRemaining(90_000)).toBe('01:30');
    expect(formatClockRemaining(3599_000)).toBe('59:59');
  });

  it('switches to h/m at an hour and d/h at a day', () => {
    expect(formatClockRemaining(3600_000)).toBe('1h 0m');
    expect(formatClockRemaining(5.5 * 3600_000)).toBe('5h 30m');
    expect(formatClockRemaining(86400_000)).toBe('1d 0h');
    expect(formatClockRemaining(26 * 3600_000)).toBe('1d 2h');
  });
});

describe('reminderLeadSeconds', () => {
  it('is a quarter of the clock, capped at 6 hours', () => {
    expect(reminderLeadSeconds(1800)).toBe(450);
    expect(reminderLeadSeconds(3600)).toBe(900);
    expect(reminderLeadSeconds(43200)).toBe(10800);
    expect(reminderLeadSeconds(MAX_PICK_SECONDS)).toBe(21600);
  });

  it('always leaves the reminder strictly before expiry', () => {
    for (const { seconds } of SLOW_PICK_OPTIONS) {
      const lead = reminderLeadSeconds(seconds);
      expect(lead).toBeGreaterThan(0);
      expect(lead).toBeLessThan(seconds);
    }
  });
});

describe('pickDeadlineMs', () => {
  it('adds the limit (seconds) to the anchor timestamp', () => {
    const anchor = '2026-07-04T12:00:00.000Z';
    const start = Date.parse(anchor);
    expect(pickDeadlineMs(anchor, 90)).toBe(start + 90_000);
    expect(pickDeadlineMs(anchor, 86400)).toBe(start + 86400_000);
  });

  it('tolerates the Postgres " " timestamp separator', () => {
    expect(pickDeadlineMs('2026-07-04 12:00:00+00', 60)).toBe(
      pickDeadlineMs('2026-07-04T12:00:00+00', 60),
    );
  });

  it('returns 0 (already expired) when the anchor is missing', () => {
    expect(pickDeadlineMs(null, 3600)).toBe(0);
    expect(pickDeadlineMs(undefined, 3600)).toBe(0);
  });
});
