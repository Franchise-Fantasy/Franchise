// Core trade types shared across the trade hooks and the many components that
// render proposals. Split out of the former monolithic useTrades.ts.

export interface TradeItemRow {
  id: string;
  player_id: string | null;
  draft_pick_id: string | null;
  from_team_id: string;
  to_team_id: string;
  player_name: string | null;
  player_position: string | null;
  player_pro_team: string | null;
  pick_season: string | null;
  pick_round: number | null;
  pick_original_team_name: string | null;
  /** Protection THIS trade adds to the pick (null if none). */
  protection_threshold: number | null;
  /** The pick's CURRENT protection from a prior trade — shown so the detail
   *  view reveals a condition this trade isn't the source of. */
  pick_protection_threshold: number | null;
  pick_protection_owner_name: string | null;
  pick_swap_season: string | null;
  pick_swap_round: number | null;
}

export interface TradeProposalRow {
  id: string;
  league_id: string;
  proposed_by_team_id: string;
  status: string;
  proposed_at: string;
  accepted_at: string | null;
  review_expires_at: string | null;
  completed_at: string | null;
  transaction_id: string | null;
  notes: string | null;
  counteroffer_of: string | null;
  /** When true, this trade was proposed during a live draft — bypasses
   *  the league's veto/review window and executes immediately on
   *  counter-party accept. Visibility is limited to involved teams +
   *  commissioner (see get_trade_proposals_for_league RPC). */
  is_in_draft: boolean;
  teams: {
    id: string;
    team_id: string;
    status: string;
    team_name: string;
    drop_player_ids: string[];
  }[];
  items: TradeItemRow[];
  /** Items from the original proposal this counters — used for "NEW" badges */
  original_items?: TradeItemRow[];
}
