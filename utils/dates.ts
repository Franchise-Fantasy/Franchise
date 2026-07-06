import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getSportToday, nextSlateRollover } from '@/utils/leagueTime';

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

/**
 * Hook that returns today's date string and refreshes when the app
 * returns from background (handles midnight rollover while backgrounded).
 */
export function useToday(): string {
  const [today, setToday] = useState<string>(() => toDateStr(new Date()));
  const todayRef = useRef(today);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const now = toDateStr(new Date());
        if (now !== todayRef.current) {
          todayRef.current = now;
          setToday(now);
        }
      }
    });
    return () => sub.remove();
  }, []);

  return today;
}

/**
 * Slate-anchored "today" (sport TZ, 5am-ET rollover) — the date space every
 * game-data query lives in (game_schedule/live_player_stats/player_games.game_date,
 * daily_lineups.lineup_date). Use this, NOT {@link useToday}, anywhere the value
 * is compared against those columns: between local midnight and 5am ET the two
 * differ by a day, and useToday (local midnight) would point a screen at a
 * slate-empty future day while last night's games are still on the prior slate.
 *
 * Refreshes on two triggers so it flips at the slate rollover, not local
 * midnight: (1) app foreground (catches a rollover that happened while
 * backgrounded) and (2) a timer armed for the next 5am-ET rollover (catches it
 * while the app stays open).
 */
export function useSportToday(sport: string | null | undefined): string {
  const [today, setToday] = useState<string>(() => getSportToday(sport));

  useEffect(() => {
    const sync = () =>
      setToday((prev) => {
        const now = getSportToday(sport);
        return now === prev ? prev : now;
      });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });

    let timer: ReturnType<typeof setTimeout>;
    const armRollover = () => {
      // +1s cushion so the wall clock is unambiguously past the rollover.
      const delay = nextSlateRollover(sport).getTime() - Date.now() + 1000;
      timer = setTimeout(() => {
        sync();
        armRollover();
      }, Math.max(delay, 1000));
    };
    armRollover();

    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [sport]);

  return today;
}

/**
 * The day a league's roster/matchup calendar should open on.
 *
 * For a not-yet-started league (season opens in the future) this is opening
 * night, so the user lands on their team instead of the empty pre-tipoff gap
 * day and having to step forward. In-season it's just today. YYYY-MM-DD string
 * compare is safe (lexicographic order == chronological order).
 */
export function defaultLeagueDay(
  today: string,
  firstWeekStart: string | null | undefined,
): string {
  return firstWeekStart && firstWeekStart > today ? firstWeekStart : today;
}

/** Format "YYYY-MM-DD" as "Mon, Feb 27" style label. */
export function formatDayLabel(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Format "YYYY-MM-DD" as a compact "Feb 27" label (no weekday). */
export function formatShortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** Format "YYYY-MM-DD" as "Feb 27, 2027" (short month, with year). */
export function formatIsoDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format an instant as "Sun, Jun 8, 8:00 PM EST" — local time WITH an explicit
 * timezone label. Use for any string built on one device and read on another
 * (e.g. a push notification body sent to all league members): a bare wall-clock
 * time is ambiguous across zones, so the label disambiguates it.
 *
 * Renders in the formatting device's local zone. On engines without full ICU
 * the `timeZoneName` may come through as a GMT offset (e.g. "GMT-5") instead of
 * an abbreviation — still unambiguous.
 */
export function formatDateTimeWithZone(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}
