export interface ChatConversation {
  id: string;
  league_id: string;
  type: 'league' | 'dm' | 'trade';
  created_at: string;
  trade_proposal_id?: string | null;
}

export interface ChatMember {
  id: string;
  conversation_id: string;
  team_id: string;
  last_read_at: string;
  last_read_message_id: string | null;
  created_at: string;
}

export type ChatMessageType = 'text' | 'poll' | 'trade' | 'rumor' | 'survey' | 'image' | 'gif' | 'trade_update';

export type TradeUpdateEvent = 'proposed' | 'accepted' | 'rejected' | 'countered' | 'completed' | 'vetoed' | 'cancelled';

export interface TradeUpdateContent {
  event: TradeUpdateEvent;
  team_name: string | null;
  proposal_id: string;
}

export interface TradeSummaryMove {
  asset: string;
  asset_type: 'player' | 'pick' | 'swap';
  from_team_name: string;
  to_team_name: string;
  protection: string | null;
  avg_fpts: number | null;
}

export interface TradeSummary {
  teams: { team_id: string; team_name: string }[];
  moves: TradeSummaryMove[];
  total_assets: number;
  team_count: number;
  hype_tier: 'minor' | 'major' | 'blockbuster';
  hype_score: number;
}

export interface RumorContent {
  player_name: string;
  template: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  team_id: string;
  content: string;
  type: ChatMessageType;
  created_at: string;
  team_name?: string;
  // Embedded poll data (present for type='poll', from get_messages_page RPC)
  poll_question?: string;
  poll_options?: string[];
  poll_type?: 'single' | 'multi';
  poll_closes_at?: string;
  poll_is_anonymous?: boolean;
  poll_show_live_results?: boolean;
  // Embedded trade data (present for type='trade', from get_messages_page RPC)
  trade_summary?: TradeSummary;
  // Embedded survey data (present for type='survey', from get_messages_page RPC)
  survey_title?: string;
  survey_description?: string;
  survey_question_count?: number;
  survey_closes_at?: string;
  survey_results_visibility?: 'everyone' | 'commissioner';
}

export interface ChatReaction {
  id: string;
  message_id: string;
  team_id: string;
  emoji: string;
  created_at: string;
}

export interface ConversationPreview {
  id: string;
  league_id: string;
  type: 'league' | 'dm' | 'trade';
  created_at: string;
  last_message: string | null;
  last_message_at: string | null;
  last_message_team_name: string | null;
  unread_count: number;
  other_team_name?: string;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
  team_names: string[];
}
