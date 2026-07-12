// Thin re-export — the position-limit checkers live in rosterSlotsShared.ts
// (the zero-dep file shared byte-for-byte with client code) so client and
// edge can't drift. Client twin: utils/roster/positionLimits.ts.
export {
  checkPositionLimits,
  checkPositionLimitsForRoster,
  type PositionLimits,
} from '../../../utils/roster/rosterSlotsShared.ts';
