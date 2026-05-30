import { PlayerGameLog } from '@/types/player';

/**
 * Collapses duplicate game-log rows on the same date down to one. A player can
 * pick up ghost rows from backfill after a trade; keep the row with the most
 * minutes (the real appearance). Shared by usePlayerGameLog (single player) and
 * useRosterGameLogs (batch) so the two never dedupe differently.
 */
export function dedupeGameLogsByDate(rows: PlayerGameLog[]): PlayerGameLog[] {
  const seen = new Map<string, PlayerGameLog>();
  for (const row of rows) {
    if (!row.game_date) continue;
    const existing = seen.get(row.game_date);
    if (!existing || row.min > existing.min) {
      seen.set(row.game_date, row);
    }
  }
  return Array.from(seen.values());
}
