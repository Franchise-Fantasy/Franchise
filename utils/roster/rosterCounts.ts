import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/queryKeys";
import { supabase } from "@/lib/supabase";

/**
 * A team's active roster count is cached under THREE independent keys:
 * `rosterInfo` (useTeamRosterInfo — PlayerDetailModal's add/IR gates),
 * `freeAgentRosterInfo` (useFreeAgentRosterInfo — the free-agent list's
 * `rosterIsFull` gate and open-slot counter), and `leagueOwnership` (whose
 * roster_slot column feeds the roster-needs chips). Every move that changes
 * which players occupy an *active* seat must expire all three.
 *
 * Missing one is invisible for exactly the global 5-minute `staleTime` and
 * then fixes itself, which is what made an IR designation appear not to
 * register: the roster page's IR move expired `rosterInfo` only, so the
 * free-agent tab kept serving its pre-IR active count and refused the add
 * until the cache went stale on its own.
 *
 * Scoped to the league, not the team: `['rosterInfo', leagueId]` prefix-matches
 * every team in it, which is exact for the acting user (one team per league)
 * and is also what the realtime fan-out in `useRosterChanges` needs — it learns
 * a league_players row changed without learning whose it was.
 */
export function invalidateRosterCounts(
  queryClient: QueryClient,
  leagueId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["rosterInfo", leagueId] });
  queryClient.invalidateQueries({ queryKey: ["freeAgentRosterInfo", leagueId] });
  queryClient.invalidateQueries({
    queryKey: queryKeys.leagueOwnership(leagueId),
  });
}

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
