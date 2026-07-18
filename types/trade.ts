/**
 * Single source of truth for trade proposal statuses. Use `TRADE_STATUS.X`
 * instead of bare string literals so typos are compile errors and the value
 * set has one definition. The column is plain `text` in Postgres (no CHECK),
 * so this object IS the contract — keep it in sync with the statuses
 * execute-trade / reverse-trade / accept_trade_proposal actually write.
 */
export const TRADE_STATUS = {
  /** Proposed, awaiting the other team(s) to accept/reject. */
  PENDING: 'pending',
  /** All parties accepted; ready to execute (or enter review). */
  ACCEPTED: 'accepted',
  /** Under commissioner / league-vote review before execution. */
  IN_REVIEW: 'in_review',
  /** Accepted but a traded player has a game in progress — executes next slate. */
  DELAYED: 'delayed',
  /** Execution blocked on roster overflow; a team must submit drops. */
  PENDING_DROPS: 'pending_drops',
  /** Executed — players/picks transferred, transaction filed. */
  COMPLETED: 'completed',
  /** A party declined the proposal. */
  REJECTED: 'rejected',
  /** Proposer withdrew before execution. */
  CANCELLED: 'cancelled',
  /** Commissioner or league vote vetoed during review. */
  VETOED: 'vetoed',
  /** Commissioner unwound a completed trade. */
  REVERSED: 'reversed',
} as const;

export type TradeStatus = (typeof TRADE_STATUS)[keyof typeof TRADE_STATUS];

/** Per-team response within a multi-team proposal. */
export const TEAM_RESPONSE = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
} as const;

export type TeamResponse = (typeof TEAM_RESPONSE)[keyof typeof TEAM_RESPONSE];

export type TradeVetoType = 'commissioner' | 'league_vote' | 'none';

export interface TradeProposal {
  id: string;
  league_id: string;
  proposed_by_team_id: string;
  status: TradeStatus;
  proposed_at: string;
  accepted_at: string | null;
  review_expires_at: string | null;
  completed_at: string | null;
  transaction_id: string | null;
  notes: string | null;
}

export interface TradeProposalTeam {
  id: string;
  proposal_id: string;
  team_id: string;
  status: TeamResponse;
  responded_at: string | null;
  // Joined
  team_name?: string;
}

export interface TradeProposalItem {
  id: string;
  proposal_id: string;
  player_id: string | null;
  draft_pick_id: string | null;
  from_team_id: string;
  to_team_id: string;
  // Pick conditions
  protection_threshold?: number | null;
  pick_swap_season?: string | null;
  pick_swap_round?: number | null;
  // Joined for display
  player_name?: string;
  player_position?: string;
  player_pro_team?: string;
  pick_season?: string;
  pick_round?: number;
  pick_original_team_name?: string;
}

export interface TradeVote {
  id: string;
  proposal_id: string;
  team_id: string;
  vote: 'veto' | 'approve';
  voted_at: string;
}

// Local state used in the trade builder modal
export interface TradeBuilderPlayer {
  player_id: string;
  name: string;
  position: string;
  pro_team: string;
  avg_fpts: number;
  /** NBA headshot external ID — populated from picker selection or
   *  back-filled by the post-seed fetch for counteroffer/edit flows. */
  external_id_nba?: string | null;
  to_team_id: string; // destination team for this asset
}

export interface TradeBuilderPick {
  draft_pick_id: string;
  season: string;
  round: number;
  original_team_name: string;
  estimated_fpts: number;
  /** Overall pick number (`draft_picks.pick_number`) so the lane label reads
   *  "2026 1st · Pick 4". Null until the draft order is actually determined —
   *  see `formatPickLabel`. */
  display_pick?: number | null;
  to_team_id: string; // destination team for this asset
  protection_threshold?: number; // top-N protected (undefined = unprotected)
}

export interface TradeBuilderSwap {
  season: string;
  round: number;
  beneficiary_team_id: string; // gets the better pick
  counterparty_team_id: string; // the other team
}

export interface TradeBuilderTeam {
  team_id: string;
  team_name: string;
  sending_players: TradeBuilderPlayer[];
  sending_picks: TradeBuilderPick[];
  sending_swaps: TradeBuilderSwap[];
}

// Estimated avg FPTS value per draft round for fairness calculation
export const DRAFT_PICK_VALUES: Record<number, number> = {
  1: 25,
  2: 18,
  3: 12,
  4: 8,
  5: 5,
};

export function estimatePickFpts(round: number): number {
  return DRAFT_PICK_VALUES[round] ?? 4;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

/**
 * Format a draft pick for display: "2026 1st", "2027 2nd", etc.
 *
 * `pickNumber` is the OVERALL pick (`draft_picks.pick_number`), not the team's
 * round-relative slot — a team drafting 8th in a 10-team league holds pick 8 in
 * round 1 and pick 18 in round 2. Pass it only when the draft order is actually
 * determined; `pick_number` is null until then (future seasons carry a
 * placeholder `slot_number` that means nothing — see `buildFutureDraftPicks`),
 * and the label correctly degrades to "2027 1st" with no invented number.
 */
export function formatPickLabel(season: string, round: number, pickNumber?: number | null): string {
  // Draft for "2026-27" season happens in summer 2026, so use the start year
  const year = parseInt(season.split('-')[0], 10);
  const base = `${year} ${ORDINALS[round - 1] ?? `${round}th`}`;
  if (pickNumber != null) return `${base} · Pick ${pickNumber}`;
  return base;
}

/** Short format for logs/notifications: "'26 1st", "'27 2nd", etc. */
export function formatPickLabelShort(season: string, round: number): string {
  const year = String(parseInt(season.split('-')[0], 10)).slice(-2);
  return `'${year} ${ORDINALS[round - 1] ?? `${round}th`}`;
}

/** Format a protection for display: "Top-3 protected" */
export function formatProtection(threshold: number | undefined | null): string {
  if (!threshold) return '';
  return `Top-${threshold} protected`;
}

/**
 * Compact continuation for the protection "story line" in
 * `<PickConditionRow>`. Sits next to a lock-icon `Badge` (e.g. "TOP-1")
 * and explains the consequence in arrow form using the shortest team
 * label the caller can give (typically a tricode).
 *
 * Semantics — protection "holds" when the lottery slot is INSIDE the
 * threshold (e.g. landing #1 with a Top-1 protection). When that
 * happens, ownership reverts to `protectionOwnerLabel`. When the
 * protection misses, the pick conveys to `currentTeamLabel`.
 *
 * - `holds = 'pending'`: pre-lottery — both branches with a slot range
 *    arrow (`#1 → RH · else SPO` / `#1-4 → LAL · else OKC`).
 * - `holds = true`: post-lottery, protection activated.
 * - `holds = false`: post-lottery, pick conveyed.
 */
export function formatProtectionStory(
  threshold: number,
  protectionOwnerLabel: string,
  currentTeamLabel: string,
  holds: boolean | 'pending',
): string {
  // The leading "TOP-N" badge already communicates the threshold and
  // the "if protection holds" semantic, so the story just names the two
  // outcomes. Threshold is intentionally unused here.
  void threshold;
  if (holds === 'pending') {
    return `${protectionOwnerLabel} · else ${currentTeamLabel}`;
  }
  if (holds) {
    return `Kept by ${protectionOwnerLabel}`;
  }
  return `Conveyed to ${currentTeamLabel}`;
}

/**
 * Compact continuation for a pick swap. Sits next to a swap-icon
 * `Badge variant="turf"` and names where the better pick lands.
 */
export function formatSwapStory(
  beneficiaryLabel: string,
  _counterpartyLabel: string,
): string {
  return `Better pick → ${beneficiaryLabel}`;
}
