import { supabase } from "@/lib/supabase";

export interface TeamStanding {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  streak: string;
  division: number | null;
}

/**
 * Regular-standings team rows for a league, ordered wins desc then points_for
 * desc. Shared by the Standings page and the home StandingsSection (both use
 * the queryKeys.standings key) so the column list and ordering can't drift.
 */
export async function fetchStandingsTeams(leagueId: string): Promise<TeamStanding[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, tricode, logo_key, wins, losses, ties, points_for, points_against, streak, division")
    .eq("league_id", leagueId)
    .order("wins", { ascending: false })
    .order("points_for", { ascending: false });
  if (error) throw error;
  return data as unknown as TeamStanding[];
}
