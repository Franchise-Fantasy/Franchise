// Thin re-export — the position-limit checkers live in rosterSlotsShared.ts
// (the zero-dep file shared byte-for-byte with edge functions) so client and
// edge can't drift. Edge twin: supabase/functions/_shared/positionLimits.ts.
export {
  checkPositionLimits,
  checkPositionLimitsForRoster,
  type PositionLimits,
} from '@/utils/roster/rosterSlotsShared';
