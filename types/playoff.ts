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
