

interface Player {
  id: string;
  name: string;
  position: string;
  nba_team: string;
}

interface DraftState {
  id: string;
  league_id: string;
  status: 'unscheduled' | 'pending' | 'in_progress' | 'complete';
  type: 'initial' | 'rookie';
  current_pick_number: number;
  current_pick_timestamp: string;
  time_limit: number;
  rounds: number;
  picks_per_round: number;
  draft_date?: string;
  season?: string;
  initial_draft_order?: string;
  snake?: boolean;
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
  original_team_id: string;
  player_id?: string;
  slot_number: number;
  pick_in_round: number;
  current_team?: {
    name: string;
    tricode: string | null;
  };
  original_team?: {
    name: string;
    tricode: string | null;
  };
  player?: {
    name: string;
    position: string;
  };
}

export { CurrentPick, DraftState, Pick, Player };

