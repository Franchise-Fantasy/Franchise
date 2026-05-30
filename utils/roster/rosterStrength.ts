import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { isActiveRosterSlot } from '@/utils/roster/rosterSlots';
import { effectiveFantasyPoints } from '@/utils/scoring/fantasyPoints';

/**
 * Non-age roster analytics for single-year (keeper/redraft) leagues, where a
 * roster's weighted age means nothing. Ranks each team by the total FPTS/G its
 * roster produces — a current-season strength signal — instead of by age.
 * Mirrors the team-grouping/ranking shape of buildLeagueComparison in
 * rosterAge.ts so the two stay legible side by side.
 */

export interface TeamStrengthProfile {
  teamId: string;
  totalFpts: number; // sum of effectiveFantasyPoints across the roster
  playerCount: number;
}

export interface LeagueStrengthComparison {
  myRank: number; // 1 = highest total FPTS/G in the league
  totalTeams: number;
  myTotalFpts: number;
  leagueAvgFpts: number;
  allProfiles: TeamStrengthProfile[]; // sorted desc (index 0 = strongest)
}

export function buildLeagueStrengthComparison(
  allPlayers: (PlayerSeasonStats & { team_id: string; roster_slot?: string | null })[],
  scoringWeights: ScoringWeight[],
  myTeamId: string,
  prevSeasonFptsMap?: Map<string, number>,
  minGames?: number,
): LeagueStrengthComparison | null {
  // Group players by team. IR/TAXI players aren't active contributors, so they
  // don't count toward roster strength — otherwise a team stashing injured
  // stars on IR looks stronger than its actual lineup.
  const byTeam = new Map<string, PlayerSeasonStats[]>();
  for (const p of allPlayers) {
    const tid = p.team_id;
    if (!tid) continue;
    if (!isActiveRosterSlot(p.roster_slot)) continue;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid)!.push(p);
  }

  // Sum each team's effective FPTS/G (clamp negatives to 0 so a bad sample
  // never drags a team's strength below zero, matching the weighting in
  // calculateRosterAgeProfile).
  const profiles: TeamStrengthProfile[] = [];
  for (const [teamId, teamPlayers] of byTeam) {
    let totalFpts = 0;
    for (const p of teamPlayers) {
      totalFpts += Math.max(effectiveFantasyPoints(p, scoringWeights, prevSeasonFptsMap, minGames), 0);
    }
    profiles.push({
      teamId,
      totalFpts: Math.round(totalFpts * 10) / 10,
      playerCount: teamPlayers.length,
    });
  }

  const myProfile = profiles.find((p) => p.teamId === myTeamId);
  if (!myProfile || profiles.length < 2) return null;

  const leagueAvgFpts =
    Math.round((profiles.reduce((s, p) => s + p.totalFpts, 0) / profiles.length) * 10) / 10;

  // Rank by total FPTS (1 = strongest)
  const sorted = [...profiles].sort((a, b) => b.totalFpts - a.totalFpts);
  const myRank = sorted.findIndex((p) => p.teamId === myTeamId) + 1;

  return {
    myRank,
    totalTeams: profiles.length,
    myTotalFpts: myProfile.totalFpts,
    leagueAvgFpts,
    allProfiles: sorted,
  };
}
