/**
 * Pure roster-slot / position-eligibility primitives shared between client
 * and edge runtimes.
 *
 * No `react-native`, no `@/lib/supabase`, no Deno-specific imports — this file
 * must stay safe to import from both Metro (client) and Deno (edge functions).
 *
 * Consumed by:
 *   - utils/roster/rosterSlots.ts (client; adds display labels)
 *   - utils/roster/positionLimits.ts (client limit checker)
 *   - supabase/functions/_shared/positionLimits.ts (edge limit checker)
 *   - supabase/functions/autodraft/index.ts (edge draft autopick)
 *   - supabase/functions/make-draft-pick/index.ts (edge manual draft pick)
 */

// Position spectrum: PG → SG → SF → PF → C
// A player spanning two positions is eligible for everything in between.
// e.g. SF-PG covers PG, SG, SF.
//
// WNBA players come from BDL with bare-letter tokens ("G", "F", "G-F",
// "F-C"). Each bare token maps to a spectrum range so it works alongside
// NBA tokens — "G" covers PG–SG, "F" covers SF–PF, "G-F" covers PG–PF.
export const POSITION_SPECTRUM: string[] = ['PG', 'SG', 'SF', 'PF', 'C'];

// [start, end] indices into POSITION_SPECTRUM for every token a player
// position string can contain.
export const POSITION_TOKEN_RANGES: Record<string, [number, number]> = {
  PG: [0, 0],
  SG: [1, 1],
  SF: [2, 2],
  PF: [3, 3],
  C: [4, 4],
  G: [0, 1],   // WNBA bare guard
  F: [2, 3],   // WNBA bare forward
};

export const SLOT_ELIGIBLE_POSITIONS: Record<string, string[]> = {
  PG: ['PG'],
  SG: ['SG'],
  SF: ['SF'],
  PF: ['PF'],
  C: ['C'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
};

/** Returns the base slot name, stripping UTIL numbering (e.g. UTIL2 → UTIL). */
export function baseSlotName(slot: string): string {
  return /^UTIL\d+$/.test(slot) ? 'UTIL' : slot;
}

/** Returns all positions a player is eligible for based on the spectrum.
 *  Bare WNBA tokens ("G", "F") expand to their spectrum range so combined
 *  tokens like "G-F" / "F-C" still produce contiguous spans. */
export function getEligiblePositions(playerPosition: string): string[] {
  const ranges = playerPosition
    .split('-')
    .map((p) => POSITION_TOKEN_RANGES[p])
    .filter((r): r is [number, number] => r !== undefined);
  if (ranges.length === 0) return [];

  const min = Math.min(...ranges.map(([s]) => s));
  const max = Math.max(...ranges.map(([, e]) => e));
  return POSITION_SPECTRUM.slice(min, max + 1);
}

/** Returns true if a player with the given position can fill the given slot. */
export function isEligibleForSlot(playerPosition: string, slotPosition: string): boolean {
  const base = baseSlotName(slotPosition);
  if (['UTIL', 'BE', 'IR'].includes(base)) return true;

  const eligible = SLOT_ELIGIBLE_POSITIONS[base];
  if (!eligible) return false;

  const playerPositions = getEligiblePositions(playerPosition);
  return playerPositions.some((pos) => eligible.includes(pos));
}

/** Returns every limit-key the player could match against — spectrum
 *  positions plus their bare-letter parents (G covers PG/SG; F covers
 *  SF/PF). Lets one check work for NBA limits (PG/SG/SF/PF/C) and WNBA
 *  limits (G/F/C) without sport branching. */
export function getLimitMatchKeys(playerPosition: string): string[] {
  const eligible = getEligiblePositions(playerPosition);
  const keys = new Set<string>(eligible);
  if (eligible.includes('PG') || eligible.includes('SG')) keys.add('G');
  if (eligible.includes('SF') || eligible.includes('PF')) keys.add('F');
  return Array.from(keys);
}
