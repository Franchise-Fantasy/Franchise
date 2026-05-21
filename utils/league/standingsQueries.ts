import { supabase } from "@/lib/supabase";
import { type MatchupRow } from "@/utils/scoring/allPlayRecord";

import { type TeamStanding } from "./standingsResolve";

// The pure standings type + resolver live in standingsResolve.ts (supabase-free,
// so they're unit-testable). Re-exported here so consumers keep importing
// everything standings-related from '@/utils/league/standingsQueries'.
export { resolveStandings } from "./standingsResolve";
export type { TeamStanding } from "./standingsResolve";

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

/**
 * Finalized regular-season matchups (excludes playoffs) for H2H tiebreakers and
 * the all-play cache. Shared by the Standings page and the home StandingsSection
 * under the queryKeys.standingsH2h key. Returns the allPlayRecord MatchupRow
 * shape so callers can feed it to both resolveStandings and computeAllPlayRecords.
 */
export async function fetchStandingsMatchups(leagueId: string): Promise<MatchupRow[]> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select("home_team_id, away_team_id, winner_team_id, home_score, away_score, home_category_wins, away_category_wins, category_results, week_number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .is("playoff_round", null);
  if (error) throw error;
  return data as unknown as MatchupRow[];
}
