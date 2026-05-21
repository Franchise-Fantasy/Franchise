import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';

import { getEligiblePositions , baseSlotName } from './rosterSlots';


export type PositionLimits = Partial<Record<string, number | null>>;

interface RosterPlayer {
  position: string;
  roster_slot?: string;
}

const IR_TAXI_SLOTS: readonly string[] = ['IR', ROSTER_SLOT.TAXI];

/** Filter out IR/TAXI players — they don't count toward position limits. */
function activeOnly(roster: RosterPlayer[]): RosterPlayer[] {
  return roster.filter(
    (p) => !p.roster_slot || !IR_TAXI_SLOTS.includes(baseSlotName(p.roster_slot)),
  );
}

/** Returns every limit-key the player could match against — spectrum
 *  positions plus their bare-letter parents (G covers PG/SG; F covers
 *  SF/PF). Lets one check work for NBA limits (PG/SG/SF/PF/C) and WNBA
 *  limits (G/F/C) without sport branching. */
function getLimitMatchKeys(playerPosition: string): string[] {
  const eligible = getEligiblePositions(playerPosition);
  const keys = new Set<string>(eligible);
  if (eligible.includes('PG') || eligible.includes('SG')) keys.add('G');
  if (eligible.includes('SF') || eligible.includes('PF')) keys.add('F');
  return Array.from(keys);
}

/** Count players per base position using spectrum eligibility. */
function countByPosition(roster: RosterPlayer[]): Record<string, number> {
  const counts: Record<string, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0, G: 0, F: 0 };
  for (const p of roster) {
    for (const key of getLimitMatchKeys(p.position)) {
      counts[key] = (counts[key] ?? 0) + 1;
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
  for (const pos of getLimitMatchKeys(incomingPlayerPosition)) {
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
