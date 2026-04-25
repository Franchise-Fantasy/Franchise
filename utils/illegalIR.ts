import { Alert } from "react-native";

import { supabase } from "@/lib/supabase";

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

  const exempt = new Set(exemptPlayerIds);
  const illegal: IllegalIRPlayer[] = [];
  for (const p of players ?? []) {
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
