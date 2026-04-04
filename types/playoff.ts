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
