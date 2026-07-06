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
  FOURTH_PLACE: 'fourth_place',
  MISSED_PLAYOFFS: 'missed_playoffs',
} as const;

export type PlayoffResult = (typeof PLAYOFF_RESULT)[keyof typeof PLAYOFF_RESULT];

/**
 * Map a free-text / OCR playoff-result value onto one of the fixed placements,
 * or null if it isn't a recognizable finish. Guards against the vision model
 * inventing values outside the allowed set (e.g. "semifinalist", "lost in R2")
 * that would otherwise render as a raw chip. Only used on the import path —
 * never re-run on the rollover's own `eliminated_round_N` / `playoff_participant`
 * markers.
 */
const PLAYOFF_RESULT_SYNONYMS: Record<string, PlayoffResult> = {
  champion: 'champion',
  champions: 'champion',
  champ: 'champion',
  winner: 'champion',
  '1st': 'champion',
  first: 'champion',
  'first place': 'champion',
  'runner up': 'runner_up',
  runnerup: 'runner_up',
  finalist: 'runner_up',
  '2nd': 'runner_up',
  second: 'runner_up',
  'second place': 'runner_up',
  'lost final': 'runner_up',
  'lost finals': 'runner_up',
  'third place': 'third_place',
  third: 'third_place',
  '3rd': 'third_place',
  bronze: 'third_place',
  'fourth place': 'fourth_place',
  fourth: 'fourth_place',
  '4th': 'fourth_place',
  'missed playoffs': 'missed_playoffs',
  missed: 'missed_playoffs',
  dnq: 'missed_playoffs',
  'did not qualify': 'missed_playoffs',
};

export function normalizePlayoffResult(raw: string | null | undefined): PlayoffResult | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return PLAYOFF_RESULT_SYNONYMS[key] ?? null;
}

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
