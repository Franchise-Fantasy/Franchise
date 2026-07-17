/**
 * BDL date → ET "slate date" mapping.
 *
 * Zero-dep so both Deno (supabase/functions/_shared/bdl.ts re-exports it) and
 * jest can load it — the previous home, bdl.ts, reads `Deno.env` at module
 * scope and is unloadable from the client test runner. This function decides
 * which slate a game's rows are filed under (live_player_stats/player_games
 * `game_date`), so it is worth having under test — a slate-date mismatch is
 * exactly what caused the poll-live-stats matview-refresh storm.
 */

/**
 * Convert a BDL game's UTC date/datetime to the ET "slate date" it belongs to.
 * Slate date = ET calendar date, except tipoffs before 5am ET are bucketed
 * back to the previous day so a 10pm ET tipoff (= 02:00 UTC next day) still
 * groups with the previous night's slate. Returns null if input is missing or
 * unparseable.
 *
 * If the input has no time component (e.g. NBA's `date: "YYYY-MM-DD"`), the
 * date is returned as-is — BDL's plain date already matches the schedule day.
 */
export function bdlGameSlateDate(input: string | null | undefined): string | null {
  if (!input) return null;
  if (input.length <= 10) return input.slice(0, 10);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  const hourStr = parts.find(p => p.type === "hour")?.value;
  if (!y || !m || !day || !hourStr) return null;
  if (parseInt(hourStr, 10) < 5) {
    const prev = new Date(`${y}-${m}-${day}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  }
  return `${y}-${m}-${day}`;
}
