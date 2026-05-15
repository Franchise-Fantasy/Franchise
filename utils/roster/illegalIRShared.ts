/**
 * Pure illegal-IR helpers shared between client and edge runtimes.
 *
 * No `react-native`, no `@/lib/supabase`, no Deno-specific imports — this file
 * must stay safe to import from both Metro (client) and Deno (edge functions).
 *
 * Consumed by:
 *   - utils/roster/illegalIR.ts (client; adds DB + UI helpers)
 *   - supabase/functions/_shared/illegalIR.ts (edge; adds DB helper with explicit supabase param)
 */

// Injury statuses that allow a player to remain on IR.
// Anything else (null, 'active', 'PROB') counts as "healthy enough to play"
// and means the player is not IR-eligible.
export const IR_ELIGIBLE_STATUSES = new Set(["OUT", "SUSP", "DOUBT", "QUES"]);

export interface IllegalIRPlayer {
  player_id: string;
  name: string;
  status: string | null;
}

export function isIrEligibleStatus(status: string | null | undefined): boolean {
  return IR_ELIGIBLE_STATUSES.has(status ?? "");
}

/**
 * Pure filter: given the candidate IR-slot players (with status), return the
 * subset that are illegally on IR — i.e. their injury status no longer
 * qualifies them, and they aren't in the exempt set.
 */
export function extractIllegalIRPlayers(
  players: Array<{ id: string; name: string | null; status: string | null }>,
  exemptPlayerIds: string[] = [],
): IllegalIRPlayer[] {
  const exempt = new Set(exemptPlayerIds);
  const illegal: IllegalIRPlayer[] = [];
  for (const p of players) {
    if (isIrEligibleStatus(p.status)) continue;
    if (exempt.has(p.id)) continue;
    illegal.push({
      player_id: p.id,
      name: p.name ?? "Unknown",
      status: p.status ?? null,
    });
  }
  return illegal;
}

export function formatIllegalIRError(players: IllegalIRPlayer[]): string {
  if (players.length === 0) return "";
  if (players.length === 1) {
    return `${players[0].name} is on IR but no longer injured. Move them off IR before making other roster moves.`;
  }
  const names = players.map((p) => p.name).join(", ");
  return `${names} are on IR but no longer injured. Move them off IR before making other roster moves.`;
}
