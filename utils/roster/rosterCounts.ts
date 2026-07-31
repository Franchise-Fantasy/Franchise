import { supabase } from "@/lib/supabase";

/**
 * Active roster size for a team = total league_players rows minus those in
 * non-active slots (IR/TAXI — the same set as `isActiveSlot` in
 * rosterCutsShared.ts). Centralizes the count pattern duplicated across trade
 * validation (accept / propose / detail) and the free-agent add flow to gate
 * roster space. Subtract-from-total keeps NULL roster_slot rows counted as
 * active (a `not.in` filter would silently drop them).
 */
export async function fetchActiveRosterCount(
  leagueId: string,
  teamId: string,
): Promise<number> {
  const [allRes, inactiveRes] = await Promise.all([
    supabase
      .from("league_players")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("team_id", teamId),
    supabase
      .from("league_players")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .in("roster_slot", ["IR", "TAXI"]),
  ]);
  return (allRes.count ?? 0) - (inactiveRes.count ?? 0);
}

/**
 * Which of `playerIds` currently sit in a non-active slot (IR/TAXI)?
 * Used by the trade drop-math to count an outgoing player against the sender's
 * active roster only when he actually occupies an active seat — a traded-away
 * IR or taxi player frees no cap room.
 */
export async function fetchInactiveSlotPlayerIds(
  leagueId: string,
  playerIds: string[],
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const { data } = await supabase
    .from("league_players")
    .select("player_id")
    .eq("league_id", leagueId)
    .in("player_id", playerIds)
    .in("roster_slot", ["IR", "TAXI"]);
  return new Set((data ?? []).map((r) => r.player_id));
}
