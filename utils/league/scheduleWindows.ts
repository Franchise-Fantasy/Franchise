/**
 * Break-aware fantasy schedule planner — the pure calendar logic shared between
 * the generate-schedule edge function and the create-league wizard preview.
 *
 * No `react-native`, no `@/lib/supabase`, no Deno-specific imports — this file
 * must stay safe to import from both Metro (client) and Deno (edge functions),
 * so the small date helpers below are inlined rather than imported (matching
 * the zero-dep convention of utils/roster/rosterSlotsShared.ts).
 *
 * A "merge window" is a calendar range (NBA All-Star break, NBA Cup knockouts,
 * the WNBA FIBA World Cup break) whose overlapping fantasy week(s) collapse into
 * a single longer matchup — a "double week". Merging is the ONLY mechanism: a
 * multi-week zero-game gap (FIBA) is expressed as a merge window spanning the
 * last pre-break game-week through the resume, so the dead span is bridged into
 * one matchup with real games on both ends.
 *
 * Semantics — PRESERVE matchup count: `regularSeasonWeeks` is the number of
 * matchups (round-robin rounds). A merge makes one week span more calendar days,
 * so the season's calendar end shifts later — it never changes how many matchups
 * a team plays. This keeps the round-robin and odd-team bye math in
 * generate-schedule untouched.
 *
 * Consumed by:
 *   - supabase/functions/generate-schedule/index.ts (authoritative; writes the rows)
 *   - components/create-league/StepSeason.tsx (wizard end-date / max-weeks preview)
 */

export interface MergeWindow {
  /** Inclusive YYYY-MM-DD start of the window. */
  start: string;
  /** Inclusive YYYY-MM-DD end of the window. */
  end: string;
  /** Short label surfaced on the double-week badge (e.g. "All-Star Break"). */
  label?: string;
  /** Optional merges (NBA Cup) only apply when the commissioner opts in.
   *  Callers filter these out BEFORE calling planScheduleWeeks. */
  optional?: boolean;
  /** End-of-season break (WNBA FIBA World Cup) that sits at the very end of the
   *  season with little/no play after it. The fantasy season — regular season
   *  AND playoffs — ends BEFORE this window rather than scheduling through it, so
   *  the championship can't be frozen across the break. Consumed by
   *  `schedulableEnd` (the wizard/edit-modal max-weeks cap); the planner itself
   *  treats it like any other window (a graceful bridge only if ever reached). */
  terminal?: boolean;
}

export interface PlannedWeek {
  /** 1-based, contiguous across regular season + playoffs. */
  weekNumber: number;
  startDate: string;
  endDate: string;
  isPlayoff: boolean;
  /** True when this week absorbed one or more merge windows (spans >1 week). */
  isDoubleWeek: boolean;
  /** Label of the first merge window absorbed, for the UI badge. */
  mergeLabel?: string;
}

export interface PlanScheduleOpts {
  /** YYYY-MM-DD fantasy season start (the league's resolved season_start_date). */
  seasonStart: string;
  /** Number of regular-season matchups (round-robin rounds). PRESERVED. */
  regularSeasonWeeks: number;
  /** Number of playoff weeks appended after the regular season. */
  playoffWeeks: number;
  /** Merge windows for the league's sport+season (optional ones pre-filtered). */
  mergeWindows: MergeWindow[];
  /** Day-of-week fantasy weeks END on: 0=Sunday (default — NBA/WNBA Mon–Sun
   *  weeks) or 1=Monday (NFL Tue–Mon weeks, so MNF isn't stranded in the next
   *  matchup). Callers pass `getSportModule(sport).weekEndDow`. */
  weekEndDow?: number;
}

/**
 * Number of days in Week 1 given the season-start day-of-week and the day
 * weeks end on. Mirror of `week1Length` in utils/leagueTime.ts — kept inline
 * so this file has zero imports and stays loadable from both Metro and Deno.
 *
 * The natural span runs from the start day through the next `weekEndDow`; a
 * span of ≤4 days is extended a full week so the first matchup is never a
 * stub. Sun-ending (NBA/WNBA): Mon→7, Tue→6, Wed→5, Thu→11, Fri→10, Sat→9,
 * Sun→8. Mon-ending (NFL): Tue→7, Wed→6 (2026 opener), Thu→5, Fri→11, Sat→10,
 * Sun→9, Mon→8.
 */
function week1Length(startDow: number, weekEndDow: number): number {
  const natural = ((weekEndDow - startDow + 7) % 7) + 1;
  return natural <= 4 ? natural + 7 : natural;
}

/** Day-of-week (0=Sun) for a YYYY-MM-DD date, computed at noon UTC to dodge DST. */
function dayOfWeek(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** Add N days to a YYYY-MM-DD date. UTC-anchored so there are no DST surprises. */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + n);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Two inclusive YYYY-MM-DD ranges overlap (string compare is correct for ISO dates). */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Last date the fantasy schedule may extend to. A `terminal` merge window (the
 * WNBA FIBA World Cup break, which sits at the very end of the season) acts as a
 * wall: the fantasy season — regular season AND playoffs — finishes before it,
 * so the championship can't straddle the break. Returns the day before the
 * earliest in-range terminal window, else `seasonEnd`. Used by the wizard /
 * edit-modal week caps so a league can't be scheduled into/through the break.
 */
export function schedulableEnd(seasonEnd: string, mergeWindows: MergeWindow[]): string {
  const starts = mergeWindows
    .filter((w) => w.terminal && w.start <= seasonEnd)
    .map((w) => w.start)
    .sort();
  return starts.length > 0 ? addDays(starts[0], -1) : seasonEnd;
}

/**
 * Walk the calendar from `seasonStart`, emitting one PlannedWeek per matchup.
 * Week 1 absorbs leading days via week1Length; weeks 2+ are full 7-day weeks
 * ending on `weekEndDow` (Mon–Sun by default, Tue–Mon for NFL). When a week
 * overlaps a merge window, its end extends to the window's end (and re-checks
 * adjacency), collapsing the straddling weeks into one double week.
 */
export function planScheduleWeeks(opts: PlanScheduleOpts): PlannedWeek[] {
  const { seasonStart, regularSeasonWeeks, playoffWeeks, weekEndDow = 0 } = opts;
  // Past windows can't affect a season that starts after them — drop them so a
  // mid-season or post-break league behaves exactly like the no-windows case.
  const windows = opts.mergeWindows.filter((w) => w.end >= seasonStart);

  const total = regularSeasonWeeks + playoffWeeks;
  const weeks: PlannedWeek[] = [];
  let cursor = seasonStart;

  while (weeks.length < total) {
    const isFirst = weeks.length === 0;
    const wStart = cursor;
    const naturalEnd = isFirst
      ? addDays(cursor, week1Length(dayOfWeek(cursor), weekEndDow) - 1)
      : addDays(cursor, 6);

    // Absorb any merge window this week reaches into. Each extension strictly
    // grows wEnd (bounded by the latest window end), so the loop terminates.
    let wEnd = naturalEnd;
    let mergeLabel: string | undefined;
    let extended = true;
    while (extended) {
      extended = false;
      for (const mw of windows) {
        if (overlaps(wStart, wEnd, mw.start, mw.end) && mw.end > wEnd) {
          if (!mergeLabel) mergeLabel = mw.label;
          wEnd = mw.end;
          extended = true;
        }
      }
    }

    const isDoubleWeek = wEnd > naturalEnd;
    weeks.push({
      weekNumber: weeks.length + 1,
      startDate: wStart,
      endDate: wEnd,
      isPlayoff: weeks.length >= regularSeasonWeeks,
      isDoubleWeek,
      mergeLabel: isDoubleWeek ? mergeLabel : undefined,
    });

    cursor = addDays(wEnd, 1);
  }

  return weeks;
}
