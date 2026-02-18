// Maps each fantasy roster slot to the NBA positions eligible to fill it.
// NBA positions from the players table: 'Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center'

const ALL_POSITIONS = ['Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center'];

export const SLOT_ELIGIBILITY: Record<string, string[]> = {
  PG: ['Guard', 'Guard-Forward'],
  SG: ['Guard', 'Guard-Forward'],
  SF: ['Forward', 'Guard-Forward', 'Forward-Center'],
  PF: ['Forward', 'Guard-Forward', 'Forward-Center'],
  C: ['Center', 'Forward-Center'],
  G: ['Guard', 'Guard-Forward'],
  F: ['Forward', 'Guard-Forward', 'Forward-Center'],
  UTIL: ALL_POSITIONS,
  BE: ALL_POSITIONS,
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
};

/** Returns true if a player with the given NBA position can fill the given slot. */
export function isEligibleForSlot(playerPosition: string, slotPosition: string): boolean {
  const eligible = SLOT_ELIGIBILITY[slotPosition];
  if (!eligible) return false;
  return eligible.includes(playerPosition);
}
