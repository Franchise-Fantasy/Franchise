// Position spectrum: PG → SG → SF → PF → C
// A player spanning two positions is eligible for everything in between.
// e.g. SF-PG covers PG, SG, SF.
//
// ⚠️ KEEP IN SYNC with:
//   - supabase/functions/make-draft-pick/index.ts
//   - supabase/functions/autodraft/index.ts
// Deno edge functions can't import RN utils, so SLOT_ELIGIBLE_POSITIONS and
// POSITION_SPECTRUM are duplicated there. Update all three together.

const POSITION_SPECTRUM: string[] = ['PG', 'SG', 'SF', 'PF', 'C'];

const SLOT_ELIGIBLE_POSITIONS: Record<string, string[]> = {
  PG: ['PG'],
  SG: ['SG'],
  SF: ['SF'],
  PF: ['PF'],
  C: ['C'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
};

const BASE_SLOT_LABELS: Record<string, string> = {
  PG: 'PG',
  SG: 'SG',
  SF: 'SF',
  PF: 'PF',
  C: 'C',
  G: 'G',
  F: 'F',
  UTIL: 'UTIL',
  BE: 'BE',
  IR: 'IR',
};

/** Returns the base slot name, stripping UTIL numbering (e.g. UTIL2 → UTIL). */
export function baseSlotName(slot: string): string {
  return /^UTIL\d+$/.test(slot) ? 'UTIL' : slot;
}

/** Returns the display label for a slot (numbered UTILs all show "UTIL"). */
export function slotLabel(slot: string): string {
  return BASE_SLOT_LABELS[baseSlotName(slot)] ?? slot;
}

// Keep SLOT_LABELS for backward compat — but prefer slotLabel() for numbered UTIL support
export const SLOT_LABELS: Record<string, string> = BASE_SLOT_LABELS;

/** Returns all positions a player is eligible for based on the spectrum. */
export function getEligiblePositions(playerPosition: string): string[] {
  const parts = playerPosition.split('-');
  const indices = parts.map(p => POSITION_SPECTRUM.indexOf(p)).filter(i => i >= 0);
  if (indices.length === 0) return [];
  if (indices.length === 1) return [POSITION_SPECTRUM[indices[0]]];

  const min = Math.min(...indices);
  const max = Math.max(...indices);
  return POSITION_SPECTRUM.slice(min, max + 1) as unknown as string[];
}

/** Returns true if a player with the given position can fill the given slot. */
export function isEligibleForSlot(playerPosition: string, slotPosition: string): boolean {
  const base = baseSlotName(slotPosition);
  if (['UTIL', 'BE', 'IR'].includes(base)) return true;

  const eligible = SLOT_ELIGIBLE_POSITIONS[base];
  if (!eligible) return false;

  const playerPositions = getEligiblePositions(playerPosition);
  return playerPositions.some(pos => eligible.includes(pos));
}

/** Returns true if the slot is an active starter slot (not bench/IR). */
export function isStarterSlot(slot: string): boolean {
  const base = baseSlotName(slot);
  return base !== 'BE' && base !== 'IR';
}
