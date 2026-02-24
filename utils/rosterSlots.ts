// Position spectrum: PG → SG → SF → PF → C
// A player spanning two positions is eligible for everything in between.
// e.g. SF-PG covers PG, SG, SF.

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

export const SLOT_LABELS: Record<string, string> = {
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
  if (['UTIL', 'BE', 'IR'].includes(slotPosition)) return true;

  const eligible = SLOT_ELIGIBLE_POSITIONS[slotPosition];
  if (!eligible) return false;

  const playerPositions = getEligiblePositions(playerPosition);
  return playerPositions.some(pos => eligible.includes(pos));
}
