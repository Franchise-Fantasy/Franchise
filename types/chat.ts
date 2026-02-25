export interface ChatConversation {
  id: string;
  league_id: string;
  type: 'league' | 'dm';
  created_at: string;
}

export interface ChatMember {
  id: string;
  conversation_id: string;
  team_id: string;
  last_read_at: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  team_id: string;
  content: string;
  created_at: string;
  team_name?: string;
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
  type: 'league' | 'dm';
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
