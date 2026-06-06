import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
