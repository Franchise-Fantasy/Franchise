// Edge-function version of illegal-IR detection.
// Keep in sync with utils/illegalIR.ts on the client.

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
 * `exemptPlayerIds` — players to ignore when computing the illegal set. Used
 * when the caller's action already resolves the lockout for those players
 * (e.g. the pending trade drops them, or a direct-drop is dropping them).
 */
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
  const names = players.map((p) => p.name).join(", ");
  if (players.length === 1) {
    return `${names} is on IR but no longer injured. Move them off IR before making other roster moves.`;
  }
  return `${names} are on IR but no longer injured. Move them off IR before making other roster moves.`;
}
