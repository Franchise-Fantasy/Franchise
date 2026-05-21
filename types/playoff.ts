/**
 * Fixed `team_seasons.playoff_result` values written by advance-season.
 * Elimination is dynamic (`eliminated_round_${round}`) — use eliminatedRound()
 * to build one and isEliminatedResult() to test for one, rather than bare
 * 'champion' / 'runner_up' / etc. literals.
 */
export const PLAYOFF_RESULT = {
  CHAMPION: 'champion',
  RUNNER_UP: 'runner_up',
  THIRD_PLACE: 'third_place',
  MISSED_PLAYOFFS: 'missed_playoffs',
} as const;

export type PlayoffResult = (typeof PLAYOFF_RESULT)[keyof typeof PLAYOFF_RESULT];

const ELIMINATED_PREFIX = 'eliminated_round_';

/** Build the per-round elimination marker, e.g. eliminatedRound(2) → 'eliminated_round_2'. */
export function eliminatedRound(round: number): string {
  return `${ELIMINATED_PREFIX}${round}`;
}

/** True if a playoff_result is an elimination marker (any round). */
export function isEliminatedResult(result: string): boolean {
  return result.startsWith(ELIMINATED_PREFIX);
}

/** Extract the round-number suffix from an elimination marker, or null. */
export function eliminatedRoundNumber(result: string): string | null {
  return isEliminatedResult(result) ? result.slice(ELIMINATED_PREFIX.length) : null;
}

export interface PlayoffBracketSlot {
  id: string;
  league_id: string;
  season: string;
  round: number;
  bracket_position: number;
  matchup_id: string | null;
  team_a_id: string | null;
  team_a_seed: number | null;
  team_b_id: string | null;
  team_b_seed: number | null;
  winner_id: string | null;
  is_bye: boolean;
  is_third_place: boolean;
  /** Populated client-side from league_matchups join */
  team_a_score?: number | null;
  /** Populated client-side from league_matchups join */
  team_b_score?: number | null;
}

export interface PlayoffSeedPick {
  id: string;
  league_id: string;
  season: string;
  round: number;
  picking_team_id: string;
  picking_seed: number;
  picked_opponent_id: string | null;
  picked_at: string | null;
}
