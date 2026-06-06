

interface Player {
  id: string;
  name: string;
  position: string;
  pro_team: string;
}

interface DraftState {
  id: string;
  league_id: string;
  status: 'unscheduled' | 'pending' | 'in_progress' | 'paused' | 'complete';
  type: 'initial' | 'rookie';
  current_pick_number: number;
  current_pick_timestamp: string;
  /** Set while paused: when the commissioner paused, and how many ms were left
   *  on the on-the-clock pick so resume can continue from there. */
  paused_at?: string | null;
  paused_remaining_ms?: number | null;
  /** Snapshot of time_limit captured when the current pick started, so a
   *  mid-draft pick-time change only affects future picks. Falls back to
   *  time_limit when absent (pre-migration / pre-deploy). */
  current_pick_time_limit?: number;
  time_limit: number;
  /** When both set, rounds after `accelerate_after_round` use
   *  `accelerated_time_limit` seconds. NULL/absent = no acceleration. */
  accelerate_after_round?: number | null;
  accelerated_time_limit?: number | null;
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
    pro_team: string | null;
  };
}

export { CurrentPick, DraftState, Pick, Player };

