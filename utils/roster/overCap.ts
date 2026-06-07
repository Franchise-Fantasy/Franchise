import { Alert } from "react-native";

import { supabase } from "@/lib/supabase";

import {
  computeOverCapState,
  formatOverCapError,
  type OverCapState,
} from "@/utils/roster/overCapShared";

// Re-export the shared types/helpers so callers can `from '@/utils/roster/overCap'`.
export { computeOverCapState, formatOverCapError, type OverCapState };

/**
 * Fetch the over-capacity state for a team.
 *
 * `exemptPlayerIds` lets a caller whose action would remove some of the
 * active roster (e.g. a trade dropping players in-flight) discount them
 * from the count — otherwise the lock would block the exact action that
 * resolves it. Mirrors `fetchIllegalIRPlayers`' exempt semantics.
 *
 * "Active" = roster_slot NOT IN ('IR', 'TAXI'). roster_size on leagues
 * defines the capacity of that pool (UTIL + BE + position slots, IR/TAXI
 * are extra).
 *
 * Future-dated rows are excluded. A deferred/locked add (and the add half of
 * a locked-day add+drop) inserts its league_players row immediately with a
 * future `acquired_at` (next slate rollover), but the player isn't on the
 * roster yet — the roster grid hides it (see components/roster/rosterData.ts).
 * Counting it here is what falsely tripped the "11/10, roster locked" lock the
 * moment a deferred add was queued. This guard is a *current-state* check, so
 * it only counts rows that are already active; the forward-looking overflow
 * projection (assert_can_add_free_agent RPC) keeps counting the future row.
 */
export async function fetchOverCapState(
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<OverCapState> {
  const [{ data: leagueRow, error: leagueErr }, { data: activeRows, error: activeErr }] =
    await Promise.all([
      supabase.from("leagues").select("roster_size").eq("id", leagueId).single(),
      supabase
        .from("league_players")
        .select("player_id")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .not("roster_slot", "in", '("IR","TAXI")')
        .lte("acquired_at", new Date().toISOString()),
    ]);
  if (leagueErr) throw leagueErr;
  if (activeErr) throw activeErr;

  const rosterSize = leagueRow?.roster_size ?? 13;
  const exemptSet = new Set(exemptPlayerIds);
  const activeCount = (activeRows ?? []).length;
  const exemptCount = (activeRows ?? []).filter((r) =>
    exemptSet.has(r.player_id),
  ).length;

  return computeOverCapState(activeCount, rosterSize, exemptCount);
}

/**
 * Throws when the team is over capacity. Use as a preflight in roster-
 * mutating actions (free-agent add, waiver claim) so the lock surfaces
 * before any DB write happens.
 *
 * `exemptPlayerIds` — see `fetchOverCapState` for semantics.
 */
export async function assertNoOverCap(
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<void> {
  const state = await fetchOverCapState(leagueId, teamId, exemptPlayerIds);
  if (state.isOver) {
    throw new Error(formatOverCapError(state));
  }
}

/**
 * UI-friendly preflight: returns false (and Alerts) when the team is
 * over capacity, so callsites can early-return without UI duplication.
 *
 * Usage: `if (!(await guardOverCap(leagueId, teamId))) return;`
 */
export async function guardOverCap(
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<boolean> {
  const state = await fetchOverCapState(leagueId, teamId, exemptPlayerIds);
  if (!state.isOver) return true;
  Alert.alert("Roster Over Capacity", formatOverCapError(state));
  return false;
}
