import { supabase } from "@/lib/supabase";

/**
 * Active roster size for a team = total league_players rows minus those on IR.
 * Centralizes the active+IR count pattern duplicated across trade validation
 * (accept / propose / detail) and the free-agent add flow to gate roster space.
 * Mirrors the originals: count-only `head` queries, errors coalesced to 0.
 */
export async function fetchActiveRosterCount(
  leagueId: string,
  teamId: string,
): Promise<number> {
  const [allRes, irRes] = await Promise.all([
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
      .eq("roster_slot", "IR"),
  ]);
  return (allRes.count ?? 0) - (irRes.count ?? 0);
}
