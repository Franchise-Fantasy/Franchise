/**
 * League-day helpers — single source of truth for "what day is it" in
 * transaction/lineup contexts. All anchored to the sport's primary TZ
 * with a 5am rollover, matching `bdlGameSlateDate` (the convention already
 * used by game-data flows: sync-game-schedule, poll-live-stats, poll-injuries).
 *
 * Why 5am: late East Coast tip-offs end ~1:30am ET. By 5am ET every game in
 * any North American sport is done and we're firmly "the next day" for every
 * GM, regardless of which TZ they're physically in.
 *
 * Zero deps — only `Intl.DateTimeFormat` + `Date`. Importable from both
 * React Native (browser/Hermes) and Deno edge functions.
 *
 * Do NOT use the `new Date(d.toLocaleString(...))` pattern anywhere — it
 * has locale-parsing bugs across engines. Use `Intl.DateTimeFormat.formatToParts`.
 */

export type Sport = 'nba' | 'wnba' | 'nfl' | 'mlb' | 'nhl';

/** Sport → IANA timezone for the league's primary game day. */
const SPORT_TIMEZONE: Record<Sport, string> = {
  nba: 'America/New_York',
  wnba: 'America/New_York',
  nfl: 'America/New_York',
  mlb: 'America/New_York',
  nhl: 'America/New_York',
};

/** Hour-of-day (sport TZ) at which the league day rolls over. */
const ROLLOVER_HOUR = 5;

/** Look up the IANA TZ for a sport, defaulting to ET when unrecognized. */
export function getSportTimezone(sport: string | null | undefined): string {
  if (!sport) return SPORT_TIMEZONE.nba;
  return SPORT_TIMEZONE[sport as Sport] ?? SPORT_TIMEZONE.nba;
}

interface TzWallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
}

/** Extract wall-clock components in `timezone` from a UTC moment. */
function wallClockIn(timezone: string, at: Date): TzWallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return {
    year: parseInt(parts.find((p) => p.type === 'year')!.value, 10),
    month: parseInt(parts.find((p) => p.type === 'month')!.value, 10),
    day: parseInt(parts.find((p) => p.type === 'day')!.value, 10),
    hour: parseInt(parts.find((p) => p.type === 'hour')!.value, 10),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Slate date for an arbitrary moment in a sport's TZ. Tipoffs / events
 * before ROLLOVER_HOUR get bucketed to the previous calendar day, so a
 * 10pm ET game played past midnight still groups with that night's slate.
 *
 * For most callers prefer `getSportToday(sport)` (current moment) or
 * `getSportTomorrow(sport)` (slate after the next rollover).
 */
export function sportSlateDate(sport: string | null | undefined, at: Date = new Date()): string {
  const tz = getSportTimezone(sport);
  const wc = wallClockIn(tz, at);
  if (wc.hour < ROLLOVER_HOUR) {
    // Construct a Date at noon UTC on (year, month, day) so subtracting one
    // UTC-day lands cleanly on the previous calendar date regardless of DST.
    const prev = new Date(Date.UTC(wc.year, wc.month - 1, wc.day, 12, 0, 0));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return toDateString(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
  }
  return toDateString(wc.year, wc.month, wc.day);
}

/** Today's slate date in sport TZ, as "YYYY-MM-DD". */
export function getSportToday(sport: string | null | undefined, now: Date = new Date()): string {
  return sportSlateDate(sport, now);
}

/** Tomorrow's slate date in sport TZ, as "YYYY-MM-DD". */
export function getSportTomorrow(sport: string | null | undefined, now: Date = new Date()): string {
  const todayStr = getSportToday(sport, now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return toDateString(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
  );
}

/**
 * Exact UTC timestamp of the next rollover. Use this as a
 * `pending_transactions.execute_after` value so the cron fires at the
 * actual rollover moment — independent of the queuer's TZ.
 *
 * Handles DST: in EST the rollover is at 10:00 UTC, in EDT it's at 09:00 UTC.
 * We probe both candidate UTC hours and pick the one whose ET wall-clock
 * resolves to 05:00 on the target date.
 */
export function nextSlateRollover(
  sport: string | null | undefined,
  now: Date = new Date(),
): Date {
  const tz = getSportTimezone(sport);
  const wc = wallClockIn(tz, now);

  // Target slate date for the rollover: if we're already past today's
  // rollover, the next one is tomorrow; otherwise it's today.
  let targetYear = wc.year;
  let targetMonth = wc.month;
  let targetDay = wc.day;
  if (wc.hour >= ROLLOVER_HOUR) {
    const next = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay + 1, 12, 0, 0));
    targetYear = next.getUTCFullYear();
    targetMonth = next.getUTCMonth() + 1;
    targetDay = next.getUTCDate();
  }

  // ET offset is -5 (EST) or -4 (EDT). 5am ET maps to 10:00 or 09:00 UTC.
  // Probe both; the one whose ET wall-clock is exactly 5:00 on targetDate wins.
  for (const utcHour of [9, 10]) {
    const candidate = new Date(
      Date.UTC(targetYear, targetMonth - 1, targetDay, utcHour, 0, 0),
    );
    const candWc = wallClockIn(tz, candidate);
    if (
      candWc.hour === ROLLOVER_HOUR &&
      candWc.year === targetYear &&
      candWc.month === targetMonth &&
      candWc.day === targetDay
    ) {
      return candidate;
    }
  }
  // Should never happen — fall back to UTC 10:00 (EST). Better than throwing.
  return new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 10, 0, 0));
}

/**
 * Add N days to a "YYYY-MM-DD" slate date string. UTC-anchored math so no
 * DST surprises. For roster moves, waiver expiry, etc.
 */
export function addSlateDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + n);
  return toDateString(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Number of days in Week 1 given the season-start day-of-week and the day
 * fantasy weeks END on (`weekEndDow`: 0=Sunday default for NBA/WNBA, 1=Monday
 * for NFL's Tue–Mon weeks — a Sunday end would strand Monday Night Football).
 *
 * The natural span runs from the start day through the next `weekEndDow`; a
 * span of ≤4 days is extended a full week — the 1-4 leading days get bolted
 * onto Week 1 so the first matchup is never a stub. Equivalent to the wizard's
 * preview math; mirror of the inline copy in utils/league/scheduleWindows.ts.
 *
 * Sun-ending: Mon → 7, Tue → 6, Wed → 5, Thu → 11, Fri → 10, Sat → 9, Sun → 8
 * Mon-ending: Tue → 7, Wed → 6, Thu → 5, Fri → 11, Sat → 10, Sun → 9, Mon → 8
 */
export function week1Length(startDow: number, weekEndDow = 0): number {
  const natural = ((weekEndDow - startDow + 7) % 7) + 1;
  return natural <= 4 ? natural + 7 : natural;
}

/**
 * "YYYY-MM-DD" of Week 1's last day (a `weekEndDow` day — Sunday by default,
 * Monday for NFL) given the start date. Uses {@link week1Length} so the rule
 * stays consistent across the wizard preview, schedule generator, and
 * auto-bump on draft scheduling.
 */
export function week1EndDate(startYmd: string, weekEndDow = 0): string {
  const dow = new Date(`${startYmd}T12:00:00Z`).getUTCDay();
  return addSlateDays(startYmd, week1Length(dow, weekEndDow) - 1);
}
