// Pick-clock duration model shared by the client (settings UIs, countdown,
// toasts) and the draft edge functions, which import this file directly via
// `../../../utils/draft/pickClock.ts` (same pattern as draftRanking.ts).
// Keep it dependency-free so it stays loadable in both runtimes and in Jest.

/** At/above this many seconds per pick a draft is a "slow" (async) draft:
 *  settings switch from the seconds stepper to duration chips, managers get a
 *  reminder push before their clock expires, and round acceleration is off. */
export const SLOW_PICK_MIN_SECONDS = 1800;

/** Hard ceiling for any pick clock — one day per pick. */
export const MAX_PICK_SECONDS = 86400;

/** The selectable slow-draft clocks. */
export const SLOW_PICK_OPTIONS = [
  { seconds: 1800, label: '30 min' },
  { seconds: 3600, label: '1 hr' },
  { seconds: 7200, label: '2 hrs' },
  { seconds: 14400, label: '4 hrs' },
  { seconds: 28800, label: '8 hrs' },
  { seconds: 43200, label: '12 hrs' },
  { seconds: 86400, label: '1 day' },
] as const;

export function isSlowClock(seconds: number | null | undefined): boolean {
  return seconds != null && seconds >= SLOW_PICK_MIN_SECONDS;
}

/** Humanize a pick-clock SETTING for copy ("90s", "30 min", "8 hrs", "1 day").
 *  Non-round values fall back to compact compound form ("1h 30m"). */
export function formatPickClock(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return rem ? `${m}m ${rem}s` : `${m} min`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const rem = Math.floor((seconds % 3600) / 60);
    return rem ? `${h}h ${rem}m` : `${h} hr${h === 1 ? '' : 's'}`;
  }
  const d = Math.floor(seconds / 86400);
  const remH = Math.floor((seconds % 86400) / 3600);
  return remH ? `${d}d ${remH}h` : `${d} day${d === 1 ? '' : 's'}`;
}

/** Format a live countdown. Under an hour keeps the urgent MM:SS ticker;
 *  longer clocks read as "5h 32m" / "2d 4h" (second-level precision is noise
 *  at that scale and would overflow the draft-strip timer chip). */
export function formatClockRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds >= 86400) {
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (totalSeconds >= 3600) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** How far BEFORE expiry the slow-draft reminder push fires: a quarter of the
 *  clock, capped at 6 hours (a 1-day clock reminds with 6h left; a 30-min
 *  clock with 7.5 min left). Only meaningful for slow clocks. */
export function reminderLeadSeconds(timeLimit: number): number {
  return Math.min(21600, Math.floor(timeLimit / 4));
}

/** Epoch-ms deadline for a pick: when it started + the seconds it was given.
 *  The clock's deadline is never stored — it's always this derivation from the
 *  `current_pick_timestamp` anchor + the `current_pick_time_limit ?? time_limit`
 *  snapshot. Returns 0 when the anchor is missing (treat as already expired).
 *  Shared so the reminder, the stalled-draft sweeper, and pause math agree. */
export function pickDeadlineMs(pickStartedAt: string | null | undefined, limitSeconds: number): number {
  if (!pickStartedAt) return 0;
  return new Date(pickStartedAt.replace(' ', 'T')).getTime() + limitSeconds * 1000;
}
