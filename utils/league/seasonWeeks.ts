import {
  getCurrentSeason,
  getMergeWindows,
  getSeasonEnd,
  type Sport,
} from '@/constants/LeagueDefaults';
import { schedulableEnd, planScheduleWeeks } from '@/utils/league/scheduleWindows';
import { earliestSeasonStart } from '@/utils/league/seasonStart';

// No `@/utils/dates` import here (even though it has the equivalent
// `toDateStr`) — this file must stay React Native-free so the seasonWeeks
// unit tests don't drag RN's ESM entrypoint into Jest's import graph (see
// CLAUDE.md's paired-file test-import-graph note).
function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Pure season-length math shared by the create-league wizard, both import
 * wizards, and the commissioner's Edit Season Settings modal. Extracted from
 * StepSeason.tsx so non-component modules (and tests) don't import a React
 * component tree to reach it.
 */

/**
 * Default fantasy-season start as a local-midnight Date: tomorrow (a league
 * can never start on the day it's created — scoring needs at least a full
 * day's lead), floored to the pro season's opening night when that's still
 * ahead (an NBA league created in July can't start before the mid-October
 * tipoff — there'd be months of gameless weeks). Week 1 then absorbs whatever
 * leading days fall before the next Sunday — see `week1Length` in
 * utils/leagueTime: Mon/Tue/Wed produce a 5-7 day Week 1, Thu/Fri/Sat/Sun
 * produce an 8-11 day Week 1 ending the second Sunday.
 */
export function defaultSeasonStart(sport: Sport, season: string): Date {
  const [y, m, d] = earliestSeasonStart(sport, season).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The wizard-state fields {@link applyCupWeekToggle} reads and re-fits. */
interface CupToggleFields {
  sport: Sport;
  season: string;
  seasonStartDate: string | null;
  regularSeasonWeeks: number;
  playoffWeeks: number;
  tradeDeadlineWeek: number;
  combineCupWeek?: boolean;
}

/**
 * Re-fit the week counts after the NBA Cup double-week toggle flips. The
 * merged matchup spans two calendar weeks, so turning it on means one fewer
 * matchup fits before the season end (and one more when turning it off).
 * Regular-season weeks refill to the new max only when they already sat at
 * the old max — a deliberately shorter season is left alone. Shared by the
 * create-league, Sleeper-import, and screenshot-import wizard reducers;
 * without it a wizard sitting at the no-Cup max would submit a week count
 * that schedules past the pro season's end (NumberStepper shrinks its max
 * but never clamps an already-over-max value).
 *
 * `prev` is the wizard state BEFORE the toggle flipped; `next` already
 * carries the new `combineCupWeek`.
 */
export function applyCupWeekToggle<T extends CupToggleFields>(
  next: T,
  prev: Pick<CupToggleFields, 'regularSeasonWeeks' | 'playoffWeeks' | 'combineCupWeek'>,
): T {
  const start = next.seasonStartDate
    ? (() => {
        const [y, m, d] = next.seasonStartDate!.split('-').map(Number);
        return new Date(y, m - 1, d);
      })()
    : defaultSeasonStart(next.sport, next.season);
  const oldMax = computeMaxWeeks(next.season, next.sport, start, prev.combineCupWeek ?? false);
  const newMax = computeMaxWeeks(next.season, next.sport, start, next.combineCupWeek ?? false);
  if (newMax === oldMax) return next; // season doesn't reach the Cup window

  const playoffWeeks = Math.min(next.playoffWeeks, Math.max(1, newMax - 1));
  const wasAtMax = prev.regularSeasonWeeks >= oldMax - prev.playoffWeeks;
  const regularSeasonWeeks = wasAtMax
    ? Math.max(1, newMax - playoffWeeks)
    : Math.min(next.regularSeasonWeeks, Math.max(1, newMax - playoffWeeks));
  const tradeDeadlineWeek = next.tradeDeadlineWeek > 0
    ? Math.min(next.tradeDeadlineWeek, regularSeasonWeeks)
    : 0;
  return { ...next, regularSeasonWeeks, playoffWeeks, tradeDeadlineWeek };
}

/** Max weeks between season start and pro season end (sport-aware).
 *  Week 1 absorbs any Thu/Fri/Sat/Sun leading days (8-11 day long week);
 *  Mon/Tue/Wed starts give a 5-7 day Week 1. Week 2+ are full Mon–Sun.
 *
 *  Mandatory merge windows (All-Star, FIBA) extend the calendar, so fewer
 *  matchup-weeks fit before the pro-season end. Optional windows (the NBA Cup
 *  double week) only count when `includeOptionalWindows` is true — pass the
 *  league's toggle so the cap tightens by one week when the Cup merge is on
 *  and relaxes when it's off. */
export function computeMaxWeeks(
  season: string,
  sport: Sport = 'nba',
  customStart?: Date,
  includeOptionalWindows = false,
): number {
  const start = customStart ?? defaultSeasonStart(sport, season);
  const endStr = getSeasonEnd(sport, season) ?? getSeasonEnd(sport, getCurrentSeason(sport))!;
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

  const windows = getMergeWindows(sport, season).filter((w) => !w.optional || includeOptionalWindows);

  // A terminal break (WNBA FIBA) walls off the end of the season: the fantasy
  // season finishes before it, so cap there instead of the real season end.
  const cap = schedulableEnd(endStr, windows);

  // Walk a generous horizon and count weeks finishing on/before the cap.
  // planScheduleWeeks handles Week-1's variable length and break-aware merging.
  const planned = planScheduleWeeks({
    seasonStart: startStr,
    regularSeasonWeeks: 60,
    playoffWeeks: 0,
    mergeWindows: windows,
  });
  return Math.max(1, planned.filter((w) => w.endDate <= cap).length);
}

export interface WeekEndDate {
  weekNumber: number;
  endDate: string;
}

/**
 * Regular-season week end dates (merge-window aware) — powers the trade-
 * deadline "Deadline Week" shortcut so "Week N" always maps to that week's
 * actual last day, including across an All-Star/Cup double week, instead of
 * a naive `week1End + 7*(N-1)` count that drifts once a merge window is
 * involved.
 */
export function regularSeasonWeekEndDates(
  sport: Sport,
  season: string,
  seasonStart: Date,
  regularSeasonWeeks: number,
  includeOptionalWindows: boolean,
): WeekEndDate[] {
  const windows = getMergeWindows(sport, season).filter((w) => !w.optional || includeOptionalWindows);
  const planned = planScheduleWeeks({
    seasonStart: toIsoDate(seasonStart),
    regularSeasonWeeks,
    playoffWeeks: 0,
    mergeWindows: windows,
  });
  return planned.map((w) => ({ weekNumber: w.weekNumber, endDate: w.endDate }));
}

/** ISO date the given regular-season week ends on (`week` clamped into range). */
export function tradeDeadlineDateForWeek(
  sport: Sport,
  season: string,
  seasonStart: Date,
  regularSeasonWeeks: number,
  week: number,
  includeOptionalWindows: boolean,
): string {
  const weeks = regularSeasonWeekEndDates(sport, season, seasonStart, regularSeasonWeeks, includeOptionalWindows);
  const idx = Math.min(Math.max(1, week), weeks.length) - 1;
  return weeks[idx].endDate;
}

/**
 * Regular-season week number whose window a given date falls in — the
 * reverse of {@link tradeDeadlineDateForWeek}, used to seed the "Deadline
 * Week" stepper's position from a persisted (possibly custom, non-week-
 * aligned) trade-deadline date.
 */
export function weekNumberForDate(weeks: WeekEndDate[], date: string): number {
  if (weeks.length === 0) return 1;
  const containing = weeks.find((w) => date <= w.endDate);
  return containing ? containing.weekNumber : weeks[weeks.length - 1].weekNumber;
}
