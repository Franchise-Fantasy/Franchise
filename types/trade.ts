export type TradeStatus =
  | 'pending'
  | 'accepted'
  | 'in_review'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'vetoed';

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
  status: 'pending' | 'accepted' | 'rejected';
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
  // Joined for display
  player_name?: string;
  player_position?: string;
  player_nba_team?: string;
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
  nba_team: string;
  avg_fpts: number;
  to_team_id: string; // destination team for this asset
}

export interface TradeBuilderPick {
  draft_pick_id: string;
  season: string;
  round: number;
  original_team_name: string;
  estimated_fpts: number;
  to_team_id: string; // destination team for this asset
}

export interface TradeBuilderTeam {
  team_id: string;
  team_name: string;
  sending_players: TradeBuilderPlayer[];
  sending_picks: TradeBuilderPick[];
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

/** Format a draft pick for display: "2026 1st", "2026 2nd", etc. */
export function formatPickLabel(season: string, round: number): string {
  const year = season.split('-')[0];
  return `${year} ${ORDINALS[round - 1] ?? `${round}th`}`;
}
