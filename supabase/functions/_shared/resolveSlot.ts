/**
 * Shared slot resolution logic for edge functions.
 * Single source of truth for determining a player's roster slot on a given day.
 */

interface DailyEntry {
  lineup_date: string;
  roster_slot: string;
}

/**
 * Resolve a player's roster slot for a specific day.
 *
 * Uses the most recent DROPPED entry in daily_lineups as the ownership boundary
 * rather than acquired_at, because acquired_at only tracks the latest acquisition
 * and gets overwritten when a player is traded away and back.
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
    if (dropDate && day >= dropDate) return "DROPPED";
    if (!dropDate && day >= today) return "DROPPED";
  }

  // Use the most recent DROPPED entry as the ownership boundary.
  // Only apply for players currently on the roster (re-acquired after a previous drop).
  // For players no longer on the roster, the DROPPED marker is the END of their
  // ownership — entries before it are still valid for historical views.
  const mostRecentDrop = dailyEntries.find((e) => e.roster_slot === "DROPPED");
  const ownershipBoundary = isOnCurrentRoster ? mostRecentDrop?.lineup_date : undefined;

  // Exact match for the requested day always wins — if a daily_lineup entry exists
  // for this exact date, the player was explicitly on the team that day regardless
  // of ownership boundaries (handles same-week drop and re-acquisition)
  const exactMatch = dailyEntries.find((e) => e.lineup_date === day && e.roster_slot !== "DROPPED");
  if (exactMatch) return exactMatch.roster_slot;

  // Most recent non-DROPPED entry on or before this day, within current ownership
  const entry = dailyEntries.find((e) =>
    e.lineup_date <= day &&
    e.roster_slot !== "DROPPED" &&
    (!ownershipBoundary || e.lineup_date > ownershipBoundary),
  );
  if (entry) return entry.roster_slot;

  // No daily entry in current ownership period — fall back to default,
  // but guard against pre-acquisition dates
  if (acquiredDate && day < acquiredDate) return "BE";
  return defaultSlot;
}

/**
 * Whether a slot counts toward team scoring.
 * Must be consistent everywhere: client, get-week-scores, finalize-week.
 */
export function isActiveSlot(slot: string): boolean {
  return slot !== "BE" && slot !== "IR" && slot !== "TAXI" && slot !== "DROPPED";
}
