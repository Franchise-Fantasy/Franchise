/**
 * Pure over-capacity helpers shared between client and edge runtimes.
 *
 * No `react-native`, no `@/lib/supabase`, no Deno-specific imports — this file
 * must stay safe to import from both Metro (client) and Deno (edge functions).
 *
 * Consumed by:
 *   - utils/roster/overCap.ts (client; adds DB + UI helpers)
 *   - supabase/functions/_shared/overCap.ts (edge; adds DB helper with explicit supabase param)
 *
 * Mirrors the illegal-IR lock pattern. When a team's active roster
 * (anything not on IR or TAXI) exceeds the league's roster_size, the team
 * is locked out of add/claim/trade-into-roster actions until they fix it.
 *
 * Typical cause: a team accumulated more picks than they could use during
 * a startup draft (via mid-draft trades), then drafted them all and ended
 * up with more active players than the roster cap allows. The lock nudges
 * them to drop someone or move them to taxi/IR before any more roster
 * adds are permitted.
 */

export interface OverCapState {
  /** Active roster count (non-IR, non-TAXI). */
  activeCount: number;
  /** League's roster_size cap. */
  rosterSize: number;
  /** True when the active roster exceeds the cap. */
  isOver: boolean;
  /** Players the team needs to drop / move off active to clear the lock. */
  overBy: number;
}

export function computeOverCapState(
  activeCount: number,
  rosterSize: number,
  exemptCount = 0,
): OverCapState {
  const effective = Math.max(0, activeCount - exemptCount);
  return {
    activeCount,
    rosterSize,
    isOver: effective > rosterSize,
    overBy: Math.max(0, effective - rosterSize),
  };
}

export function formatOverCapError(state: OverCapState): string {
  const noun = state.overBy === 1 ? 'player' : 'players';
  return `Your active roster has ${state.activeCount} players but only ${state.rosterSize} are allowed. Drop or move ${state.overBy} ${noun} to taxi or IR to unlock your roster.`;
}
