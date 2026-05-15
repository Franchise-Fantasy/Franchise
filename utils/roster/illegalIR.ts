import { Alert } from "react-native";

import { supabase } from "@/lib/supabase";

import {
  extractIllegalIRPlayers,
  formatIllegalIRError,
  IR_ELIGIBLE_STATUSES,
  isIrEligibleStatus,
  type IllegalIRPlayer,
} from "@/utils/roster/illegalIRShared";

// Re-export the shared pure helpers so existing client call sites
// (`@/utils/roster/illegalIR`) keep working unchanged.
export {
  formatIllegalIRError,
  IR_ELIGIBLE_STATUSES,
  isIrEligibleStatus,
  type IllegalIRPlayer,
};

/**
 * A player is "illegally on IR" if their roster_slot is IR but their injury
 * status no longer qualifies them for IR. While any player on a team is in
 * this state, the team is locked out of roster moves until it's resolved.
 *
 * `exemptPlayerIds` lets a caller whose action already resolves the lockout
 * for those specific players (e.g. dropping them outright, or dropping them
 * as part of a trade) pass them through — otherwise the lockout would block
 * the exact action that resolves it. Only the listed players are exempted;
 * any other illegal-IR players on the roster still block.
 */
export async function fetchIllegalIRPlayers(
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<IllegalIRPlayer[]> {
  const { data: irRows, error: irErr } = await supabase
    .from("league_players")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("roster_slot", "IR");
  if (irErr) throw irErr;

  const playerIds = (irRows ?? []).map((r) => r.player_id);
  if (playerIds.length === 0) return [];

  const { data: players, error: pErr } = await supabase
    .from("players")
    .select("id, name, status")
    .in("id", playerIds);
  if (pErr) throw pErr;

  return extractIllegalIRPlayers(players ?? [], exemptPlayerIds);
}

/**
 * Throws an error if the team has any illegal-IR players. Use as a preflight
 * check at the start of any roster-mutating action that isn't rendering a UI
 * alert itself (e.g. inside pure helpers). UI callsites should prefer
 * `guardIllegalIR` below.
 *
 * Pass `exemptPlayerIds` when the action being gated already removes one or
 * more of the illegal-IR players (e.g. the user is dropping them, or the
 * action drops them as part of a trade).
 */
export async function assertNoIllegalIR(
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<void> {
  const illegal = await fetchIllegalIRPlayers(leagueId, teamId, exemptPlayerIds);
  if (illegal.length > 0) {
    throw new Error(formatIllegalIRError(illegal));
  }
}

/**
 * UI-friendly version of the illegal-IR preflight: checks the team, and if
 * the lockout is active, shows a "Roster locked" Alert and returns false so
 * the caller can early-return. Returns true when the team is clear to act.
 *
 * Usage: `if (!(await guardIllegalIR(leagueId, teamId))) return;`
 */
export async function guardIllegalIR(
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<boolean> {
  const illegal = await fetchIllegalIRPlayers(leagueId, teamId, exemptPlayerIds);
  if (illegal.length === 0) return true;
  Alert.alert("Roster locked", formatIllegalIRError(illegal));
  return false;
}
