// Edge-function illegal-IR detection.
//
// Pure helpers (constants, types, formatter, extractor) come from
// utils/roster/illegalIRShared.ts and are byte-identical between client and
// edge. Only the DB-touching fetcher lives here, because edge functions pass
// their own supabase client as a parameter rather than importing the module
// singleton like the client does.

import {
  extractIllegalIRPlayers,
  formatIllegalIRError,
  IR_ELIGIBLE_STATUSES,
  isIrEligibleStatus,
  type IllegalIRPlayer,
} from '../../../utils/roster/illegalIRShared.ts';

export {
  formatIllegalIRError,
  IR_ELIGIBLE_STATUSES,
  isIrEligibleStatus,
  type IllegalIRPlayer,
};

/**
 * `exemptPlayerIds` — players to ignore when computing the illegal set. Used
 * when the caller's action already resolves the lockout for those players
 * (e.g. the pending trade drops them, or a direct-drop is dropping them).
 */
// deno-lint-ignore no-explicit-any
export async function fetchIllegalIRPlayers(
  supabase: any,
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

  const playerIds = (irRows ?? []).map((r: { player_id: string }) => r.player_id);
  if (playerIds.length === 0) return [];

  const { data: players, error: pErr } = await supabase
    .from("players")
    .select("id, name, status")
    .in("id", playerIds);
  if (pErr) throw pErr;

  return extractIllegalIRPlayers(players ?? [], exemptPlayerIds);
}
