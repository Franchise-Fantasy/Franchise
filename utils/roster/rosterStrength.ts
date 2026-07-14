import { PlayerGameLog, PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { isActiveRosterSlot } from '@/utils/roster/rosterSlots';
import {
  effectiveFantasyPoints,
  GameWindow,
  gameWindowSize,
  windowFantasyPoints,
} from '@/utils/scoring/fantasyPoints';

/**
 * Non-age roster analytics for single-year (keeper/redraft) leagues, where a
 * roster's weighted age means nothing. Ranks each team by its AVERAGE FPTS/G
 * per active player — a current-season strength signal that doesn't move just
 * because a team is carrying one more or one fewer body. (Summing roster totals
 * instead made the metric track active-roster count: every add/drop or IR move
 * swung a team's number by a full player's worth and could flip the ranking
 * between two equal-quality rosters. Averaging is size-independent, so the
 * "vs avg" figure is a real per-player FPTS/G delta — matching its label.)
 * Mirrors the team-grouping/ranking shape of buildLeagueComparison in
 * rosterAge.ts so the two stay legible side by side.
 */

export interface TeamStrengthProfile {
  teamId: string;
  avgFpts: number; // mean effectiveFantasyPoints across active roster players
  totalFpts: number; // sum across active players — the team's total points/day
  playerCount: number;
}

export interface LeagueStrengthComparison {
  myRank: number; // 1 = highest avg FPTS/G per player in the league
  totalTeams: number;
  myAvgFpts: number;
  leagueAvgFpts: number;
  allProfiles: TeamStrengthProfile[]; // sorted desc (index 0 = strongest)
}

export interface BuildLeagueStrengthComparisonOptions {
  prevSeasonFptsMap?: Map<string, number>;
  /** Minimum games threshold for the season window (passed to
   *  effectiveFantasyPoints — below this we fall back to prev-season). */
  minGames?: number;
  /** Time window for the FPTS/G calc. Defaults to 'season' (existing behavior:
   *  player_season_stats avg with prev-season fallback). Lx slices each
   *  player's last-N played games. */
  gameWindow?: GameWindow;
  /** Required when gameWindow is L5/L10/L15. Player_id → DESC-ordered game
   *  logs (matches useRosterGameLogs / useLeagueGameLogs output). Missing
   *  players fall back to season average. */
  gameLogsByPlayer?: Map<string, PlayerGameLog[]>;
  /** League sport — without it an NFL roster scores 0 (the NBA stat map
   *  matches none of its weights) and every team's strength collapses. */
  sport?: string | null;
}

export function buildLeagueStrengthComparison(
  allPlayers: (PlayerSeasonStats & { team_id: string; roster_slot?: string | null })[],
  scoringWeights: ScoringWeight[],
  myTeamId: string,
  options: BuildLeagueStrengthComparisonOptions = {},
): LeagueStrengthComparison | null {
  const { prevSeasonFptsMap, minGames, gameWindow = 'season', gameLogsByPlayer, sport } = options;
  const windowSize = gameWindowSize(gameWindow);

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

  // Average each team's effective FPTS/G across its active players (clamp
  // negatives to 0 so a bad sample never drags a team's strength below zero,
  // matching the weighting in calculateRosterAgeProfile). Averaging — not
  // summing — keeps the metric independent of how many bodies a team carries.
  // For Lx windows we score each player from their last N played games;
  // players with no logs fall back to effectiveFantasyPoints so a thin sample
  // doesn't zero them out.
  const profiles: TeamStrengthProfile[] = [];
  for (const [teamId, teamPlayers] of byTeam) {
    let totalFpts = 0;
    for (const p of teamPlayers) {
      let fpts: number;
      if (windowSize != null) {
        const windowed = windowFantasyPoints(
          gameLogsByPlayer?.get(p.player_id),
          scoringWeights,
          windowSize,
          sport,
        );
        fpts = windowed ?? effectiveFantasyPoints(p, scoringWeights, prevSeasonFptsMap, minGames, sport);
      } else {
        fpts = effectiveFantasyPoints(p, scoringWeights, prevSeasonFptsMap, minGames, sport);
      }
      totalFpts += Math.max(fpts, 0);
    }
    profiles.push({
      teamId,
      avgFpts: Math.round((totalFpts / teamPlayers.length) * 10) / 10,
      // Sum kept alongside the average so the UI can offer a "total points/day"
      // lens (raw daily output — rewards depth) next to the size-independent
      // per-player average.
      totalFpts: Math.round(totalFpts * 10) / 10,
      playerCount: teamPlayers.length,
    });
  }

  const myProfile = profiles.find((p) => p.teamId === myTeamId);
  if (!myProfile || profiles.length < 2) return null;

  const leagueAvgFpts =
    Math.round((profiles.reduce((s, p) => s + p.avgFpts, 0) / profiles.length) * 10) / 10;

  // Rank by avg FPTS/G per player (1 = strongest). avgFpts is rounded to 1dp
  // before ranking, so teams tie often — teamId breaks the tie so the rank can't
  // ride on the input row order (see the matching comment in rosterAge.ts).
  const sorted = [...profiles].sort(
    (a, b) => b.avgFpts - a.avgFpts || a.teamId.localeCompare(b.teamId),
  );
  const myRank = sorted.findIndex((p) => p.teamId === myTeamId) + 1;

  return {
    myRank,
    totalTeams: profiles.length,
    myAvgFpts: myProfile.avgFpts,
    leagueAvgFpts,
    allProfiles: sorted,
  };
}
