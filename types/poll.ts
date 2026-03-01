export interface CommissionerPoll {
  id: string;
  league_id: string;
  conversation_id: string;
  message_id: string | null;
  team_id: string;
  question: string;
  poll_type: 'single' | 'multi';
  options: string[];
  closes_at: string;
  is_anonymous: boolean;
  show_live_results: boolean;
  created_at: string;
}

export interface PollVote {
  id: string;
  poll_id: string;
  team_id: string;
  selections: number[];
  voted_at: string;
  teams?: { name: string };
}

export interface PollResults {
  totalVotes: number;
  optionCounts: number[];
  myVote: number[] | null;
  votersByOption?: string[][];
  isClosed: boolean;
}
