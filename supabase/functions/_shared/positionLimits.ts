// Edge-function version — inlines spectrum logic to avoid import issues.

export type PositionLimits = Partial<Record<string, number | null>>;

interface RosterPlayer {
  position: string;
  roster_slot?: string;
}

const POSITION_SPECTRUM = ['PG', 'SG', 'SF', 'PF', 'C'];
const IR_TAXI_SLOTS = ['IR', 'TAXI'];

function getEligiblePositions(playerPosition: string): string[] {
  const parts = playerPosition.split('-');
  const indices = parts.map((p) => POSITION_SPECTRUM.indexOf(p)).filter((i) => i >= 0);
  if (indices.length === 0) return [];
  if (indices.length === 1) return [POSITION_SPECTRUM[indices[0]]];
  const min = Math.min(...indices);
  const max = Math.max(...indices);
  return POSITION_SPECTRUM.slice(min, max + 1);
}

function baseSlotName(slot: string): string {
  return /^UTIL\d+$/.test(slot) ? 'UTIL' : slot;
}

function activeOnly(roster: RosterPlayer[]): RosterPlayer[] {
  return roster.filter(
    (p) => !p.roster_slot || !IR_TAXI_SLOTS.includes(baseSlotName(p.roster_slot)),
  );
}

function countByPosition(roster: RosterPlayer[]): Record<string, number> {
  const counts: Record<string, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const p of roster) {
    for (const pos of getEligiblePositions(p.position)) {
      counts[pos] = (counts[pos] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Check whether adding a single player would violate any position limit.
 * Returns null if ok, or the first violated limit.
 */
export function checkPositionLimits(
  limits: PositionLimits | null | undefined,
  currentRoster: RosterPlayer[],
  incomingPlayerPosition: string,
): { position: string; current: number; max: number } | null {
  if (!limits || Object.keys(limits).length === 0) return null;

  const counts = countByPosition(activeOnly(currentRoster));
  for (const pos of getEligiblePositions(incomingPlayerPosition)) {
    const max = limits[pos];
    if (max != null && max > 0 && (counts[pos] ?? 0) >= max) {
      return { position: pos, current: counts[pos] ?? 0, max };
    }
  }
  return null;
}

/**
 * Check whether a full roster violates any position limit (for trades).
 * Returns null if ok, or the first violated limit.
 */
export function checkPositionLimitsForRoster(
  limits: PositionLimits | null | undefined,
  roster: RosterPlayer[],
): { position: string; count: number; max: number } | null {
  if (!limits || Object.keys(limits).length === 0) return null;

  const counts = countByPosition(activeOnly(roster));
  for (const [pos, max] of Object.entries(limits)) {
    if (max != null && max > 0 && (counts[pos] ?? 0) > max) {
      return { position: pos, count: counts[pos] ?? 0, max };
    }
  }
  return null;
}
