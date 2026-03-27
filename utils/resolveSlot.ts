/**
 * Shared slot resolution logic for client-side code.
 * Single source of truth for determining a player's roster slot on a given day.
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

  // Use the most recent DROPPED entry as the ownership boundary.
  // This is more reliable than acquired_at because it tracks actual data:
  // a player who was dropped and re-acquired has a DROPPED marker separating
  // the ownership periods, even if acquired_at was overwritten by a later trade.
  //
  // Only apply the boundary for players currently on the roster (re-acquired after
  // a previous drop). For players no longer on the roster, the DROPPED marker is
  // the END of their ownership — entries before it are still valid for historical views.
  const mostRecentDrop = dailyEntries.find((e) => e.roster_slot === 'DROPPED');
  const ownershipBoundary = isOnCurrentRoster ? mostRecentDrop?.lineup_date : undefined;

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
