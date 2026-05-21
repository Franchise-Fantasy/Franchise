import { supabase } from "@/lib/supabase";
import { type MatchupRow } from "@/utils/scoring/allPlayRecord";

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

/**
 * Order teams into final standings: by win pct, breaking ties within equal-pct
 * groups using the league's configured tiebreaker order (head_to_head, then
 * points_for). Returns each team with a 1-based `rank`. Pure — shared by the
 * Standings page and the home StandingsSection so the seeding logic can't drift.
 */
export function resolveStandings(
  teams: TeamStanding[],
  matchups: MatchupRow[],
  tiebreakerOrder: string[],
): (TeamStanding & { rank: number })[] {
  if (teams.length === 0) return [];

  const winPct = (t: TeamStanding) => {
    const gp = t.wins + t.losses + t.ties;
    return gp === 0 ? 0 : (t.wins + t.ties * 0.5) / gp;
  };

  const sorted = [...teams].sort((a, b) => winPct(b) - winPct(a));

  const groups: TeamStanding[][] = [];
  let currentGroup: TeamStanding[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(winPct(sorted[i]) - winPct(sorted[i - 1])) < 1e-9) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  const h2hWins = new Map<string, number>();
  const h2hKey = (a: string, b: string) => `${a}:${b}`;

  for (const m of matchups) {
    if (!m.away_team_id || !m.winner_team_id) continue;
    const loserId = m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id;
    h2hWins.set(
      h2hKey(m.winner_team_id, loserId),
      (h2hWins.get(h2hKey(m.winner_team_id, loserId)) ?? 0) + 1,
    );
  }

  function getH2HWinsInGroup(teamId: string, group: TeamStanding[]): number {
    const groupIds = new Set(group.map(t => t.id));
    let wins = 0;
    for (const otherId of groupIds) {
      if (otherId === teamId) continue;
      wins += h2hWins.get(h2hKey(teamId, otherId)) ?? 0;
    }
    return wins;
  }

  function compareTiebreaker(a: TeamStanding, b: TeamStanding, group: TeamStanding[], method: string): number {
    switch (method) {
      case 'head_to_head':
        return getH2HWinsInGroup(b.id, group) - getH2HWinsInGroup(a.id, group);
      case 'points_for':
        return b.points_for - a.points_for;
      default:
        return 0;
    }
  }

  const result: TeamStanding[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    group.sort((a, b) => {
      for (const method of tiebreakerOrder) {
        const cmp = compareTiebreaker(a, b, group, method);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    result.push(...group);
  }

  return result.map((team, index) => ({ ...team, rank: index + 1 }));
}
