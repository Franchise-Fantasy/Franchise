import {
  baseSlotName,
  getEligiblePositions,
  getLimitMatchKeys,
  isEligibleForSlot,
  POSITION_SPECTRUM,
  POSITION_TOKEN_RANGES,
  SLOT_ELIGIBLE_POSITIONS,
} from '@/utils/roster/rosterSlotsShared';

// Re-export the pure primitives so existing client call sites keep working
// unchanged. The same primitives are imported by edge functions directly
// from `rosterSlotsShared.ts` — see that file's header for the consumer list.
export {
  baseSlotName,
  getEligiblePositions,
  getLimitMatchKeys,
  isEligibleForSlot,
  POSITION_SPECTRUM,
  POSITION_TOKEN_RANGES,
  SLOT_ELIGIBLE_POSITIONS,
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

/** Returns the display label for a slot (numbered UTILs all show "UTIL"). */
export function slotLabel(slot: string): string {
  return BASE_SLOT_LABELS[baseSlotName(slot)] ?? slot;
}

// Keep SLOT_LABELS for backward compat — but prefer slotLabel() for numbered UTIL support
export const SLOT_LABELS: Record<string, string> = BASE_SLOT_LABELS;

/** Returns true if the slot is an active starter slot (not bench/IR). */
export function isStarterSlot(slot: string): boolean {
  const base = baseSlotName(slot);
  return base !== 'BE' && base !== 'IR';
}

/**
 * True if a slot counts toward active-roster analytics — i.e. starters and
 * bench, but NOT IR, TAXI, or DROPPED. Those aren't contributing to the team
 * right now, so they shouldn't inflate roster-strength aggregates. Null/empty
 * slot defaults to bench, which counts.
 */
export function isActiveRosterSlot(slot: string | null | undefined): boolean {
  const base = baseSlotName(slot ?? 'BE');
  return base !== 'IR' && base !== 'TAXI' && base !== 'DROPPED';
}
