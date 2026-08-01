/**
 * Pure "YYYY-MM-DD" day arithmetic. No React, no react-native, no `@/` imports.
 *
 * Split out of `utils/dates.ts` (which pulls in `AppState` for its hooks) so
 * pure modules — and the unit tests that import them — don't drag the React
 * Native runtime into their import graph. `utils/dates.ts` re-exports all of
 * these, so existing call sites are unchanged.
 */

/** Format a Date as "YYYY-MM-DD" in local time. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a "YYYY-MM-DD" string into a local Date (no timezone shift). */
export function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add (or subtract) days from a "YYYY-MM-DD" string. */
export function addDays(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Whole days from `fromStr` to `toStr` (both "YYYY-MM-DD"); positive when
 *  `toStr` is later. Parses at local midnight so a DST shift in the span can't
 *  skew the day count. */
export function daysBetween(fromStr: string, toStr: string): number {
  const from = parseLocalDate(fromStr);
  const to = parseLocalDate(toStr);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
