

interface Player {
  id: string;
  name: string;
  position: string;
  nba_team: string;
}

interface DraftState {
  id: string;
  league_id: string;
  current_pick_number: number;
  current_pick_timestamp: string;
  time_limit: number;
  rounds: number;
  picks_per_round: number;
}

interface CurrentPick {
  id: string;
  current_team_id: string;
}

interface Pick {
  id: string;
  pick_number: number;
  round: number;
  current_team_id: string;
  player_id?: string;
  slot_number: number;
  current_team?: {
    name: string;
  };
  player?: {
    name: string;
    position: string;
  };
}

export { CurrentPick, DraftState, Pick, Player };

