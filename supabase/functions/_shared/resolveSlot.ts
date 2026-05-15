/**
 * Shared slot resolution logic for edge functions.
 * Single source of truth for determining a player's roster slot on a given day.
 *
 * KEEP IN SYNC with utils/roster/resolveSlot.ts (client). The two files must
 * remain byte-for-byte identical below the doc-comment header — they share
 * caller assumptions (dailyEntries sorted by lineup_date DESC, same param
 * shape) and edge/client must agree on slot resolution for the same inputs.
 */

interface DailyEntry {
  lineup_date: string;
  roster_slot: string;
}

/**
 * Resolve a player's roster slot for a specific day.
 *
 * Priority:
 * 1. Drop-date guard — if player is no longer on the roster, enforce DROPPED
 * 2. Daily lineups rollover — most recent entry <= day wins
 * 3. Acquired-at guard — prevent counting games before acquisition
 * 4. Default slot fallback
 */
export function resolveSlot(params: {
  dailyEntries: DailyEntry[];
  day: string;
  defaultSlot: string;
  isOnCurrentRoster: boolean;
  dropDate?: string;
  acquiredDate?: string;
  today: string;
}): string {
  const { dailyEntries, day, defaultSlot, isOnCurrentRoster, dropDate, acquiredDate, today } = params;

  // Players no longer on this team: enforce DROPPED after their drop date
  if (!isOnCurrentRoster) {
    if (dropDate && day >= dropDate) return 'DROPPED';
    if (!dropDate && day >= today) return 'DROPPED';
  }

  // Locked-day "queued drop" handling: a DROPPED entry whose date is on or
  // before the viewed day means the player is (or will soon be) gone from
  // the roster, even if the league_players row still exists because the
  // cron hasn't processed the queued drop yet. Use acquired_at to
  // disambiguate from re-acquisition: if the player was re-acquired after
  // the drop, the DROPPED entry is historical and falls through to the
  // ownership-boundary logic below.
  const dropOnOrBeforeDay = dailyEntries.find(
    (e) => e.roster_slot === 'DROPPED' && e.lineup_date <= day,
  );
  if (dropOnOrBeforeDay) {
    const reAcquiredAfterDrop =
      acquiredDate && acquiredDate > dropOnOrBeforeDay.lineup_date;
    if (!reAcquiredAfterDrop) return 'DROPPED';
  }

  // Re-acquisition ownership boundary uses the most recent PAST DROPPED
  // entry only. Future-dated DROPPED entries (queued drops) don't affect
  // past-day slot resolution.
  const mostRecentPastDrop = dailyEntries.find(
    (e) => e.roster_slot === 'DROPPED' && e.lineup_date < day,
  );
  const ownershipBoundary = isOnCurrentRoster ? mostRecentPastDrop?.lineup_date : undefined;

  // Exact match for the requested day always wins — if a daily_lineup entry exists
  // for this exact date, the player was explicitly on the team that day regardless
  // of ownership boundaries (handles same-week drop and re-acquisition)
  const exactMatch = dailyEntries.find((e) => e.lineup_date === day && e.roster_slot !== 'DROPPED');
  if (exactMatch) return exactMatch.roster_slot;

  // Most recent non-DROPPED entry on or before this day, within current ownership
  const entry = dailyEntries.find((e) =>
    e.lineup_date <= day &&
    e.roster_slot !== 'DROPPED' &&
    (!ownershipBoundary || e.lineup_date > ownershipBoundary),
  );
  if (entry) return entry.roster_slot;

  // No daily entry in current ownership period — fall back to default,
  // but guard against pre-acquisition dates
  if (acquiredDate && day < acquiredDate) return 'BE';
  return defaultSlot;
}

/**
 * Whether a slot counts toward team scoring.
 * Must be consistent everywhere: client, get-week-scores, finalize-week.
 */
export function isActiveSlot(slot: string): boolean {
  return slot !== 'BE' && slot !== 'IR' && slot !== 'TAXI' && slot !== 'DROPPED';
}
