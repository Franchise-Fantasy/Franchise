/**
 * Strength of Schedule — measures how tough each team's
 * opponents have been (past) and will be (future).
 *
 * SoS = average win% of opponents faced.
 * Higher = tougher schedule.
 */

export interface SoSMatchup {
  home_team_id: string;
  away_team_id: string | null;
}

export interface SoSTeam {
  id: string;
  wins: number;
  losses: number;
  ties: number;
}

export interface SoSResult {
  teamId: string;
  /** Average opponent win% for completed matchups */
  pastSoS: number;
  /** Average opponent win% for remaining matchups (null if none) */
  futureSoS: number | null;
  /** Weighted combo of past + future */
  overallSoS: number;
  pastOpponents: number;
  futureOpponents: number;
}

function winPct(team: SoSTeam): number {
  const total = team.wins + team.losses + team.ties;
  if (total === 0) return 0;
  return (team.wins + 0.5 * team.ties) / total;
}

function getOpponentId(matchup: SoSMatchup, teamId: string): string | null {
  if (matchup.home_team_id === teamId) return matchup.away_team_id;
  if (matchup.away_team_id === teamId) return matchup.home_team_id;
  return null;
}

function avgOpponentWinPct(
  matchups: SoSMatchup[],
  teamId: string,
  teamMap: Map<string, SoSTeam>,
): { avg: number; count: number } {
  const opponentWinPcts: number[] = [];

  for (const m of matchups) {
    const oppId = getOpponentId(m, teamId);
    if (!oppId) continue; // bye week
    const opp = teamMap.get(oppId);
    if (!opp) continue;
    opponentWinPcts.push(winPct(opp));
  }

  if (opponentWinPcts.length === 0) return { avg: 0, count: 0 };
  const avg = opponentWinPcts.reduce((a, b) => a + b, 0) / opponentWinPcts.length;
  return { avg, count: opponentWinPcts.length };
}

export function computeStrengthOfSchedule(
  finalized: SoSMatchup[],
  unfinalized: SoSMatchup[],
  teams: SoSTeam[],
): SoSResult[] {
  const teamMap = new Map<string, SoSTeam>();
  for (const t of teams) teamMap.set(t.id, t);

  const teamIds = teams.map(t => t.id);
  const results: SoSResult[] = [];

  for (const teamId of teamIds) {
    const past = avgOpponentWinPct(finalized, teamId, teamMap);
    const future = avgOpponentWinPct(unfinalized, teamId, teamMap);

    // Weighted overall: combine past and future by number of opponents
    const totalGames = past.count + future.count;
    const overallSoS = totalGames > 0
      ? (past.avg * past.count + (future.avg ?? 0) * future.count) / totalGames
      : 0;

    results.push({
      teamId,
      pastSoS: past.avg,
      futureSoS: future.count > 0 ? future.avg : null,
      overallSoS,
      pastOpponents: past.count,
      futureOpponents: future.count,
    });
  }

  return results;
}
