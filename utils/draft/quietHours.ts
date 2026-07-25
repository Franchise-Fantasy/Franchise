// Overnight "quiet hours" for slow (async) drafts: a daily wall-clock window
// during which the pick clock is frozen so nobody lands on the clock and gets
// auto-drafted at 3am. The window is measured in the league's game timezone
// (ET) — the same "league day" reference used by utils/leagueTime.ts and the
// game-data flows — so "3am–8am" means the same thing for every GM regardless
// of where they physically are.
//
// Dependency-free (Intl only) so it loads unchanged in the RN client (the
// draft-room countdown + settings UIs), the Deno edge functions (make-draft-pick
// and the manage-draft-quiet-hours cron), and Jest — same rule as pickClock.ts.

/** The timezone the quiet window's wall clock is measured in. Matches
 *  getSportTimezone in utils/leagueTime.ts (every North-American sport → ET). */
export const QUIET_HOURS_TZ = 'America/New_York';

export interface QuietHoursConfig {
  quiet_hours_enabled?: boolean | null;
  quiet_hours_start_min?: number | null;
  quiet_hours_end_min?: number | null;
}

/** Minute-of-day (0–1439) for `at` in the quiet-hours timezone. Uses
 *  Intl.formatToParts (never `new Date(toLocaleString(...))`, which mis-parses
 *  across engines — see the leagueTime.ts warning). */
function minuteOfDayET(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUIET_HOURS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  return hour * 60 + minute;
}

/** Is `at` inside the configured quiet window? Handles a window that wraps past
 *  midnight (start > end, e.g. 23:00→06:00). Disabled or misconfigured
 *  (null/equal edges) → false, so callers can pass a raw draft row. The window
 *  is half-open [start, end): the minute it ends the clock is already live. */
export function isQuietNow(cfg: QuietHoursConfig, at: Date = new Date()): boolean {
  if (!cfg.quiet_hours_enabled) return false;
  const start = cfg.quiet_hours_start_min;
  const end = cfg.quiet_hours_end_min;
  if (start == null || end == null || start === end) return false;

  const now = minuteOfDayET(at);
  if (start < end) return now >= start && now < end; // same-day window
  return now >= start || now < end; // wraps past midnight
}

/** "8:00 AM" for a minute-of-day value — used to tell members when the draft
 *  resumes ("Resumes 8:00 AM ET") and to label the window in settings. */
export function formatMinuteOfDay(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = ((min % 60) + 60) % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** "3:00 AM – 8:00 AM ET" summary for a configured window, or null when off. */
export function formatQuietWindow(cfg: QuietHoursConfig): string | null {
  if (!cfg.quiet_hours_enabled) return null;
  const { quiet_hours_start_min: start, quiet_hours_end_min: end } = cfg;
  if (start == null || end == null || start === end) return null;
  return `${formatMinuteOfDay(start)} – ${formatMinuteOfDay(end)} ET`;
}
