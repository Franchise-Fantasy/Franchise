export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_tokens: {
        Row: {
          activity_type: string
          created_at: string
          draft_id: string | null
          expires_at: string | null
          id: string
          league_id: string | null
          matchup_id: string | null
          push_token: string
          schedule_id: string | null
          stale: boolean
          team_id: string
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string
          draft_id?: string | null
          expires_at?: string | null
          id?: string
          league_id?: string | null
          matchup_id?: string | null
          push_token: string
          schedule_id?: string | null
          stale?: boolean
          team_id: string
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          draft_id?: string | null
          expires_at?: string | null
          id?: string
          league_id?: string | null
          matchup_id?: string | null
          push_token?: string
          schedule_id?: string | null
          stale?: boolean
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_tokens_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_tokens_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_tokens_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "league_matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_tokens_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "league_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_tokens_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          league_id: string
          trade_proposal_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          trade_proposal_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          trade_proposal_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_trade_proposal_id_fkey"
            columns: ["trade_proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          last_read_at: string
          last_read_message_id: string | null
          team_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          last_read_at?: string
          last_read_message_id?: string | null
          team_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          last_read_at?: string
          last_read_message_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          league_id: string
          moderated_at: string | null
          team_id: string | null
          type: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          league_id: string
          moderated_at?: string | null
          team_id?: string | null
          type?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          league_id?: string
          moderated_at?: string | null
          team_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_pins: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_id: string
          pinned_by: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_id: string
          pinned_by: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string
          pinned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reactions: {
        Row: {
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
          team_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          team_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      commissioner_announcements: {
        Row: {
          content: string
          created_at: string
          id: string
          league_id: string
          team_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          league_id: string
          team_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          league_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissioner_announcements_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_announcements_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      commissioner_polls: {
        Row: {
          closes_at: string
          conversation_id: string
          created_at: string
          id: string
          is_anonymous: boolean
          league_id: string
          message_id: string | null
          options: Json
          poll_type: string
          question: string
          show_live_results: boolean
          team_id: string
        }
        Insert: {
          closes_at: string
          conversation_id: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          league_id: string
          message_id?: string | null
          options: Json
          poll_type?: string
          question: string
          show_live_results?: boolean
          team_id: string
        }
        Update: {
          closes_at?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          league_id?: string
          message_id?: string | null
          options?: Json
          poll_type?: string
          question?: string
          show_live_results?: boolean
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissioner_polls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_polls_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_polls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_polls_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      commissioner_surveys: {
        Row: {
          closes_at: string
          conversation_id: string
          created_at: string | null
          description: string
          id: string
          league_id: string
          message_id: string | null
          results_visibility: string
          team_id: string
          title: string
        }
        Insert: {
          closes_at: string
          conversation_id: string
          created_at?: string | null
          description?: string
          id?: string
          league_id: string
          message_id?: string | null
          results_visibility?: string
          team_id: string
          title: string
        }
        Update: {
          closes_at?: string
          conversation_id?: string
          created_at?: string | null
          description?: string
          id?: string
          league_id?: string
          message_id?: string | null
          results_visibility?: string
          team_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissioner_surveys_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_surveys_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_surveys_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioner_surveys_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_lineups: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          lineup_date: string
          player_id: string
          roster_slot: string
          team_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          lineup_date: string
          player_id: string
          roster_slot: string
          team_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          lineup_date?: string
          player_id?: string
          roster_slot?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_lineups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_lineups_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "daily_lineups_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks: {
        Row: {
          auto_drafted: boolean
          current_team_id: string | null
          draft_id: string | null
          id: string
          league_id: string
          original_team_id: string | null
          pick_number: number | null
          player_id: string | null
          protection_owner_id: string | null
          protection_threshold: number | null
          round: number
          season: string
          selected_at: string | null
          slot_number: number | null
        }
        Insert: {
          auto_drafted?: boolean
          current_team_id?: string | null
          draft_id?: string | null
          id?: string
          league_id: string
          original_team_id?: string | null
          pick_number?: number | null
          player_id?: string | null
          protection_owner_id?: string | null
          protection_threshold?: number | null
          round: number
          season: string
          selected_at?: string | null
          slot_number?: number | null
        }
        Update: {
          auto_drafted?: boolean
          current_team_id?: string | null
          draft_id?: string | null
          id?: string
          league_id?: string
          original_team_id?: string | null
          pick_number?: number | null
          player_id?: string | null
          protection_owner_id?: string | null
          protection_threshold?: number | null
          round?: number
          season?: string
          selected_at?: string | null
          slot_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_original_team_id_fkey"
            columns: ["original_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "draft_picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_protection_owner_id_fkey"
            columns: ["protection_owner_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_queue: {
        Row: {
          created_at: string | null
          draft_id: string
          id: string
          player_id: string
          priority: number
          team_id: string
        }
        Insert: {
          created_at?: string | null
          draft_id: string
          id?: string
          player_id: string
          priority: number
          team_id: string
        }
        Update: {
          created_at?: string | null
          draft_id?: string
          id?: string
          player_id?: string
          priority?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_queue_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queue_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "draft_queue_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queue_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_team_status: {
        Row: {
          autopick_on: boolean
          draft_id: string
          id: string
          last_seen_at: string
          team_id: string
        }
        Insert: {
          autopick_on?: boolean
          draft_id: string
          id?: string
          last_seen_at?: string
          team_id: string
        }
        Update: {
          autopick_on?: boolean
          draft_id?: string
          id?: string
          last_seen_at?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_team_status_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_team_status_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          created_at: string | null
          current_pick_number: number
          current_pick_timestamp: string | null
          draft_date: string | null
          draft_type: string
          id: string
          league_id: string
          picks_per_round: number | null
          rounds: number | null
          season: string | null
          status: string | null
          time_limit: number
          type: string
        }
        Insert: {
          created_at?: string | null
          current_pick_number?: number
          current_pick_timestamp?: string | null
          draft_date?: string | null
          draft_type?: string
          id?: string
          league_id: string
          picks_per_round?: number | null
          rounds?: number | null
          season?: string | null
          status?: string | null
          time_limit?: number
          type: string
        }
        Update: {
          created_at?: string | null
          current_pick_number?: number
          current_pick_timestamp?: string | null
          draft_date?: string | null
          draft_type?: string
          id?: string
          league_id?: string
          picks_per_round?: number | null
          rounds?: number | null
          season?: string | null
          status?: string | null
          time_limit?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "drafts_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      keeper_declarations: {
        Row: {
          declared_at: string
          id: string
          league_id: string
          player_id: string
          season: string
          team_id: string
        }
        Insert: {
          declared_at?: string
          id?: string
          league_id: string
          player_id: string
          season: string
          team_id: string
        }
        Update: {
          declared_at?: string
          id?: string
          league_id?: string
          player_id?: string
          season?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "keeper_declarations_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keeper_declarations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "keeper_declarations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keeper_declarations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_matchups: {
        Row: {
          away_category_wins: number | null
          away_player_scores: Json | null
          away_score: number
          away_team_id: string | null
          category_results: Json | null
          category_ties: number | null
          created_at: string | null
          home_category_wins: number | null
          home_player_scores: Json | null
          home_score: number
          home_team_id: string
          id: string
          is_finalized: boolean
          league_id: string
          playoff_round: number | null
          schedule_id: string
          stats_flushed: boolean
          week_number: number
          winner_team_id: string | null
        }
        Insert: {
          away_category_wins?: number | null
          away_player_scores?: Json | null
          away_score?: number
          away_team_id?: string | null
          category_results?: Json | null
          category_ties?: number | null
          created_at?: string | null
          home_category_wins?: number | null
          home_player_scores?: Json | null
          home_score?: number
          home_team_id: string
          id?: string
          is_finalized?: boolean
          league_id: string
          playoff_round?: number | null
          schedule_id: string
          stats_flushed?: boolean
          week_number: number
          winner_team_id?: string | null
        }
        Update: {
          away_category_wins?: number | null
          away_player_scores?: Json | null
          away_score?: number
          away_team_id?: string | null
          category_results?: Json | null
          category_ties?: number | null
          created_at?: string | null
          home_category_wins?: number | null
          home_player_scores?: Json | null
          home_score?: number
          home_team_id?: string
          id?: string
          is_finalized?: boolean
          league_id?: string
          playoff_round?: number | null
          schedule_id?: string
          stats_flushed?: boolean
          week_number?: number
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_matchups_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_matchups_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_matchups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_matchups_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "league_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_matchups_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_notification_prefs: {
        Row: {
          league_id: string
          overrides: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          league_id: string
          overrides?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          league_id?: string
          overrides?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_notification_prefs_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_payments: {
        Row: {
          created_at: string
          id: string
          league_id: string
          marked_by: string | null
          notes: string | null
          paid: boolean
          paid_at: string | null
          season: string
          self_reported_at: string | null
          status: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          marked_by?: string | null
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          season: string
          self_reported_at?: string | null
          status?: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          marked_by?: string | null
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          season?: string
          self_reported_at?: string | null
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_payments_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_payments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_players: {
        Row: {
          acquired_at: string
          acquired_via: string
          id: string
          league_id: string
          on_trade_block: boolean
          player_id: string
          position: string
          roster_slot: string | null
          team_id: string
          trade_block_interest: string[]
          trade_block_note: string | null
        }
        Insert: {
          acquired_at: string
          acquired_via: string
          id?: string
          league_id: string
          on_trade_block?: boolean
          player_id: string
          position: string
          roster_slot?: string | null
          team_id: string
          trade_block_interest?: string[]
          trade_block_note?: string | null
        }
        Update: {
          acquired_at?: string
          acquired_via?: string
          id?: string
          league_id?: string
          on_trade_block?: boolean
          player_id?: string
          position?: string
          roster_slot?: string | null
          team_id?: string
          trade_block_interest?: string[]
          trade_block_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_players_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "league_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_records: {
        Row: {
          detail: string | null
          id: string
          league_id: string
          record_type: string
          season: string | null
          team_id: string
          updated_at: string
          value: number
        }
        Insert: {
          detail?: string | null
          id?: string
          league_id: string
          record_type: string
          season?: string | null
          team_id: string
          updated_at?: string
          value: number
        }
        Update: {
          detail?: string | null
          id?: string
          league_id?: string
          record_type?: string
          season?: string | null
          team_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_records_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_roster_config: {
        Row: {
          id: string
          league_id: string
          position: string
          slot_count: number
        }
        Insert: {
          id?: string
          league_id: string
          position: string
          slot_count?: number
        }
        Update: {
          id?: string
          league_id?: string
          position?: string
          slot_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_roster_config_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_schedule: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          is_playoff: boolean
          league_id: string
          season: string
          start_date: string
          week_number: number
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          is_playoff?: boolean
          league_id: string
          season: string
          start_date: string
          week_number: number
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          is_playoff?: boolean
          league_id?: string
          season?: string
          start_date?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_schedule_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_scoring_settings: {
        Row: {
          id: string
          inverse: boolean
          is_enabled: boolean
          league_id: string
          point_value: number
          stat_name: string
        }
        Insert: {
          id?: string
          inverse?: boolean
          is_enabled?: boolean
          league_id: string
          point_value?: number
          stat_name: string
        }
        Update: {
          id?: string
          inverse?: boolean
          is_enabled?: boolean
          league_id?: string
          point_value?: number
          stat_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_scoring_settings_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_subscriptions: {
        Row: {
          auto_renew: boolean | null
          created_at: string
          expires_at: string | null
          id: string
          league_id: string
          payment_provider: string | null
          payment_provider_id: string | null
          period_type: string | null
          purchased_by: string
          rc_customer_id: string | null
          rc_product_id: string | null
          starts_at: string
          status: string
          tier: string
        }
        Insert: {
          auto_renew?: boolean | null
          created_at?: string
          expires_at?: string | null
          id?: string
          league_id: string
          payment_provider?: string | null
          payment_provider_id?: string | null
          period_type?: string | null
          purchased_by: string
          rc_customer_id?: string | null
          rc_product_id?: string | null
          starts_at?: string
          status?: string
          tier: string
        }
        Update: {
          auto_renew?: boolean | null
          created_at?: string
          expires_at?: string | null
          id?: string
          league_id?: string
          payment_provider?: string | null
          payment_provider_id?: string | null
          period_type?: string | null
          purchased_by?: string
          rc_customer_id?: string | null
          rc_product_id?: string | null
          starts_at?: string
          status?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_subscriptions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: true
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_transaction_items: {
        Row: {
          draft_pick_id: string | null
          id: string
          player_id: string | null
          team_from_id: string | null
          team_to_id: string | null
          transaction_id: string
        }
        Insert: {
          draft_pick_id?: string | null
          id?: string
          player_id?: string | null
          team_from_id?: string | null
          team_to_id?: string | null
          transaction_id: string
        }
        Update: {
          draft_pick_id?: string | null
          id?: string
          player_id?: string | null
          team_from_id?: string | null
          team_to_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_transaction_items_draft_pick_id_fkey"
            columns: ["draft_pick_id"]
            isOneToOne: false
            referencedRelation: "draft_picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "league_transaction_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_team_from_id_fkey"
            columns: ["team_from_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_team_to_id_fkey"
            columns: ["team_to_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "full_transaction_log"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "league_transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "league_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      league_transactions: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          notes: string | null
          team_id: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          notes?: string | null
          team_id?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          notes?: string | null
          team_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_waivers: {
        Row: {
          dropped_by_team_id: string | null
          id: string
          league_id: string
          on_waivers_until: string
          player_id: string
        }
        Insert: {
          dropped_by_team_id?: string | null
          id?: string
          league_id: string
          on_waivers_until: string
          player_id: string
        }
        Update: {
          dropped_by_team_id?: string | null
          id?: string
          league_id?: string
          on_waivers_until?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_waivers_dropped_by_team_id_fkey"
            columns: ["dropped_by_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_waivers_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_waivers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "league_waivers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          auto_rumors_enabled: boolean
          buy_in_amount: number | null
          cashapp_tag: string | null
          champion_team_id: string | null
          commissioner: string | null
          created_at: string | null
          created_by: string
          current_teams: number | null
          division_1_name: string
          division_2_name: string
          division_count: number
          draft_pick_trading_enabled: boolean
          faab_budget: number
          id: string
          imported_from: string | null
          initial_draft_order: string
          invite_code: string
          keeper_count: number | null
          league_type: string
          lottery_date: string | null
          lottery_draws: number
          lottery_odds: Json | null
          lottery_status: string | null
          max_future_seasons: number | null
          name: string
          offseason_step: string | null
          paypal_username: string | null
          pick_conditions_enabled: boolean
          player_lock_type: string
          playoff_seeding_format: string
          playoff_teams: number | null
          playoff_weeks: number
          position_limits: Json | null
          private: boolean
          regular_season_weeks: number
          reseed_each_round: boolean
          rookie_draft_order: string
          rookie_draft_rounds: number
          roster_size: number
          schedule_generated: boolean
          scoring_type: string
          season: string
          season_start_date: string | null
          taxi_max_experience: number | null
          taxi_slots: number
          teams: number
          tiebreaker_order: string[]
          trade_deadline: string | null
          trade_review_period_hours: number
          trade_veto_type: string
          trade_votes_to_veto: number
          venmo_username: string | null
          waiver_day_of_week: number
          waiver_period_days: number
          waiver_type: string
          weekly_acquisition_limit: number | null
        }
        Insert: {
          auto_rumors_enabled?: boolean
          buy_in_amount?: number | null
          cashapp_tag?: string | null
          champion_team_id?: string | null
          commissioner?: string | null
          created_at?: string | null
          created_by: string
          current_teams?: number | null
          division_1_name?: string
          division_2_name?: string
          division_count?: number
          draft_pick_trading_enabled?: boolean
          faab_budget?: number
          id?: string
          imported_from?: string | null
          initial_draft_order?: string
          invite_code?: string
          keeper_count?: number | null
          league_type?: string
          lottery_date?: string | null
          lottery_draws?: number
          lottery_odds?: Json | null
          lottery_status?: string | null
          max_future_seasons?: number | null
          name: string
          offseason_step?: string | null
          paypal_username?: string | null
          pick_conditions_enabled?: boolean
          player_lock_type?: string
          playoff_seeding_format?: string
          playoff_teams?: number | null
          playoff_weeks?: number
          position_limits?: Json | null
          private?: boolean
          regular_season_weeks?: number
          reseed_each_round?: boolean
          rookie_draft_order?: string
          rookie_draft_rounds?: number
          roster_size: number
          schedule_generated?: boolean
          scoring_type?: string
          season?: string
          season_start_date?: string | null
          taxi_max_experience?: number | null
          taxi_slots?: number
          teams: number
          tiebreaker_order?: string[]
          trade_deadline?: string | null
          trade_review_period_hours?: number
          trade_veto_type?: string
          trade_votes_to_veto?: number
          venmo_username?: string | null
          waiver_day_of_week?: number
          waiver_period_days?: number
          waiver_type?: string
          weekly_acquisition_limit?: number | null
        }
        Update: {
          auto_rumors_enabled?: boolean
          buy_in_amount?: number | null
          cashapp_tag?: string | null
          champion_team_id?: string | null
          commissioner?: string | null
          created_at?: string | null
          created_by?: string
          current_teams?: number | null
          division_1_name?: string
          division_2_name?: string
          division_count?: number
          draft_pick_trading_enabled?: boolean
          faab_budget?: number
          id?: string
          imported_from?: string | null
          initial_draft_order?: string
          invite_code?: string
          keeper_count?: number | null
          league_type?: string
          lottery_date?: string | null
          lottery_draws?: number
          lottery_odds?: Json | null
          lottery_status?: string | null
          max_future_seasons?: number | null
          name?: string
          offseason_step?: string | null
          paypal_username?: string | null
          pick_conditions_enabled?: boolean
          player_lock_type?: string
          playoff_seeding_format?: string
          playoff_teams?: number | null
          playoff_weeks?: number
          position_limits?: Json | null
          private?: boolean
          regular_season_weeks?: number
          reseed_each_round?: boolean
          rookie_draft_order?: string
          rookie_draft_rounds?: number
          roster_size?: number
          schedule_generated?: boolean
          scoring_type?: string
          season?: string
          season_start_date?: string | null
          taxi_max_experience?: number | null
          taxi_slots?: number
          teams?: number
          tiebreaker_order?: string[]
          trade_deadline?: string | null
          trade_review_period_hours?: number
          trade_veto_type?: string
          trade_votes_to_veto?: number
          venmo_username?: string | null
          waiver_day_of_week?: number
          waiver_period_days?: number
          waiver_type?: string
          weekly_acquisition_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leagues_champion_team_id_fkey"
            columns: ["champion_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      live_player_stats: {
        Row: {
          "3pa": number
          "3pm": number
          ast: number
          away_score: number
          blk: number
          fga: number
          fgm: number
          fta: number
          ftm: number
          game_clock: string | null
          game_date: string
          game_id: string
          game_status: number
          home_score: number
          matchup: string | null
          oncourt: boolean
          period: number | null
          pf: number
          player_id: string
          pts: number
          reb: number
          stl: number
          tov: number
          updated_at: string
        }
        Insert: {
          "3pa"?: number
          "3pm"?: number
          ast?: number
          away_score?: number
          blk?: number
          fga?: number
          fgm?: number
          fta?: number
          ftm?: number
          game_clock?: string | null
          game_date: string
          game_id: string
          game_status?: number
          home_score?: number
          matchup?: string | null
          oncourt?: boolean
          period?: number | null
          pf?: number
          player_id: string
          pts?: number
          reb?: number
          stl?: number
          tov?: number
          updated_at?: string
        }
        Update: {
          "3pa"?: number
          "3pm"?: number
          ast?: number
          away_score?: number
          blk?: number
          fga?: number
          fgm?: number
          fta?: number
          ftm?: number
          game_clock?: string | null
          game_date?: string
          game_id?: string
          game_status?: number
          home_score?: number
          matchup?: string | null
          oncourt?: boolean
          period?: number | null
          pf?: number
          player_id?: string
          pts?: number
          reb?: number
          stl?: number
          tov?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "live_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      lottery_results: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          results: Json
          season: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          results: Json
          season: string
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          results?: Json
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "lottery_results_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      nba_schedule: {
        Row: {
          away_score: number | null
          away_team: string
          created_at: string | null
          game_date: string
          game_id: string
          game_time_utc: string | null
          home_score: number | null
          home_team: string
          id: string
          season: string
          status: string | null
        }
        Insert: {
          away_score?: number | null
          away_team: string
          created_at?: string | null
          game_date: string
          game_id: string
          game_time_utc?: string | null
          home_score?: number | null
          home_team: string
          id?: string
          season: string
          status?: string | null
        }
        Update: {
          away_score?: number | null
          away_team?: string
          created_at?: string | null
          game_date?: string
          game_id?: string
          game_time_utc?: string | null
          home_score?: number | null
          home_team?: string
          id?: string
          season?: string
          status?: string | null
        }
        Relationships: []
      }
      pending_transactions: {
        Row: {
          action_type: string
          created_at: string | null
          execute_after: string
          id: string
          league_id: string
          metadata: Json | null
          player_id: string
          status: string
          target_player_id: string | null
          team_id: string
        }
        Insert: {
          action_type: string
          created_at?: string | null
          execute_after: string
          id?: string
          league_id: string
          metadata?: Json | null
          player_id: string
          status?: string
          target_player_id?: string | null
          team_id: string
        }
        Update: {
          action_type?: string
          created_at?: string | null
          execute_after?: string
          id?: string
          league_id?: string
          metadata?: Json | null
          player_id?: string
          status?: string
          target_player_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "pending_transactions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_target_player_id_fkey"
            columns: ["target_player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "pending_transactions_target_player_id_fkey"
            columns: ["target_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_swaps: {
        Row: {
          beneficiary_team_id: string
          counterparty_team_id: string
          created_at: string
          created_by_proposal_id: string | null
          id: string
          league_id: string
          resolved: boolean
          round: number
          season: string
        }
        Insert: {
          beneficiary_team_id: string
          counterparty_team_id: string
          created_at?: string
          created_by_proposal_id?: string | null
          id?: string
          league_id: string
          resolved?: boolean
          round: number
          season: string
        }
        Update: {
          beneficiary_team_id?: string
          counterparty_team_id?: string
          created_at?: string
          created_by_proposal_id?: string | null
          id?: string
          league_id?: string
          resolved?: boolean
          round?: number
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_swaps_beneficiary_team_id_fkey"
            columns: ["beneficiary_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_swaps_counterparty_team_id_fkey"
            columns: ["counterparty_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_swaps_created_by_proposal_id_fkey"
            columns: ["created_by_proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_swaps_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      player_games: {
        Row: {
          "3pa": number
          "3pm": number
          ast: number
          blk: number
          double_double: boolean
          fga: number
          fgm: number
          fta: number
          ftm: number
          game_date: string | null
          game_id: string
          id: string
          matchup: string | null
          min: number
          pf: number
          player_id: string
          pts: number
          reb: number
          stl: number
          tov: number
          triple_double: boolean
        }
        Insert: {
          "3pa"?: number
          "3pm"?: number
          ast?: number
          blk?: number
          double_double?: boolean
          fga?: number
          fgm?: number
          fta?: number
          ftm?: number
          game_date?: string | null
          game_id: string
          id?: string
          matchup?: string | null
          min?: number
          pf?: number
          player_id: string
          pts?: number
          reb?: number
          stl?: number
          tov?: number
          triple_double?: boolean
        }
        Update: {
          "3pa"?: number
          "3pm"?: number
          ast?: number
          blk?: number
          double_double?: boolean
          fga?: number
          fgm?: number
          fta?: number
          ftm?: number
          game_date?: string | null
          game_id?: string
          id?: string
          matchup?: string | null
          min?: number
          pf?: number
          player_id?: string
          pts?: number
          reb?: number
          stl?: number
          tov?: number
          triple_double?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "player_games_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_games_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_historical_stats: {
        Row: {
          avg_3pa: number | null
          avg_3pm: number | null
          avg_ast: number | null
          avg_blk: number | null
          avg_fga: number | null
          avg_fgm: number | null
          avg_fta: number | null
          avg_ftm: number | null
          avg_min: number | null
          avg_pf: number | null
          avg_pts: number | null
          avg_reb: number | null
          avg_stl: number | null
          avg_tov: number | null
          games_played: number
          id: string
          nba_team: string | null
          player_id: string
          season: string
          total_ast: number | null
          total_blk: number | null
          total_dd: number | null
          total_pts: number | null
          total_reb: number | null
          total_stl: number | null
          total_td: number | null
          total_tov: number | null
        }
        Insert: {
          avg_3pa?: number | null
          avg_3pm?: number | null
          avg_ast?: number | null
          avg_blk?: number | null
          avg_fga?: number | null
          avg_fgm?: number | null
          avg_fta?: number | null
          avg_ftm?: number | null
          avg_min?: number | null
          avg_pf?: number | null
          avg_pts?: number | null
          avg_reb?: number | null
          avg_stl?: number | null
          avg_tov?: number | null
          games_played?: number
          id?: string
          nba_team?: string | null
          player_id: string
          season: string
          total_ast?: number | null
          total_blk?: number | null
          total_dd?: number | null
          total_pts?: number | null
          total_reb?: number | null
          total_stl?: number | null
          total_td?: number | null
          total_tov?: number | null
        }
        Update: {
          avg_3pa?: number | null
          avg_3pm?: number | null
          avg_ast?: number | null
          avg_blk?: number | null
          avg_fga?: number | null
          avg_fgm?: number | null
          avg_fta?: number | null
          avg_ftm?: number | null
          avg_min?: number | null
          avg_pf?: number | null
          avg_pts?: number | null
          avg_reb?: number | null
          avg_stl?: number | null
          avg_tov?: number | null
          games_played?: number
          id?: string
          nba_team?: string | null
          player_id?: string
          season?: string
          total_ast?: number | null
          total_blk?: number | null
          total_dd?: number | null
          total_pts?: number | null
          total_reb?: number | null
          total_stl?: number | null
          total_td?: number | null
          total_tov?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_historical_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_historical_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_news: {
        Row: {
          description: string | null
          external_id: string
          fetched_at: string
          has_minutes_restriction: boolean
          id: string
          link: string
          mentioned_players: Json
          published_at: string
          return_estimate: string | null
          source: string
          title: string
        }
        Insert: {
          description?: string | null
          external_id: string
          fetched_at?: string
          has_minutes_restriction?: boolean
          id?: string
          link: string
          mentioned_players?: Json
          published_at: string
          return_estimate?: string | null
          source: string
          title: string
        }
        Update: {
          description?: string | null
          external_id?: string
          fetched_at?: string
          has_minutes_restriction?: boolean
          id?: string
          link?: string
          mentioned_players?: Json
          published_at?: string
          return_estimate?: string | null
          source?: string
          title?: string
        }
        Relationships: []
      }
      player_news_mentions: {
        Row: {
          id: string
          news_id: string
          player_id: string
        }
        Insert: {
          id?: string
          news_id: string
          player_id: string
        }
        Update: {
          id?: string
          news_id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_news_mentions_news_id_fkey"
            columns: ["news_id"]
            isOneToOne: false
            referencedRelation: "player_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_news_mentions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_news_mentions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          birthdate: string | null
          contentful_entry_id: string | null
          dynasty_value_score: number | null
          external_id_bdl: number | null
          external_id_nba: string | null
          id: string
          is_prospect: boolean
          name: string
          nba_draft_year: number | null
          nba_team: string | null
          position: string | null
          rookie: boolean | null
          school: string | null
          season_added: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          birthdate?: string | null
          contentful_entry_id?: string | null
          dynasty_value_score?: number | null
          external_id_bdl?: number | null
          external_id_nba?: string | null
          id?: string
          is_prospect?: boolean
          name: string
          nba_draft_year?: number | null
          nba_team?: string | null
          position?: string | null
          rookie?: boolean | null
          school?: string | null
          season_added?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          birthdate?: string | null
          contentful_entry_id?: string | null
          dynasty_value_score?: number | null
          external_id_bdl?: number | null
          external_id_nba?: string | null
          id?: string
          is_prospect?: boolean
          name?: string
          nba_draft_year?: number | null
          nba_team?: string | null
          position?: string | null
          rookie?: boolean | null
          school?: string | null
          season_added?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      playoff_bracket: {
        Row: {
          bracket_position: number
          created_at: string | null
          id: string
          is_bye: boolean
          is_third_place: boolean
          league_id: string
          matchup_id: string | null
          round: number
          season: string
          team_a_id: string | null
          team_a_seed: number | null
          team_b_id: string | null
          team_b_seed: number | null
          winner_id: string | null
        }
        Insert: {
          bracket_position: number
          created_at?: string | null
          id?: string
          is_bye?: boolean
          is_third_place?: boolean
          league_id: string
          matchup_id?: string | null
          round: number
          season: string
          team_a_id?: string | null
          team_a_seed?: number | null
          team_b_id?: string | null
          team_b_seed?: number | null
          winner_id?: string | null
        }
        Update: {
          bracket_position?: number
          created_at?: string | null
          id?: string
          is_bye?: boolean
          is_third_place?: boolean
          league_id?: string
          matchup_id?: string | null
          round?: number
          season?: string
          team_a_id?: string | null
          team_a_seed?: number | null
          team_b_id?: string | null
          team_b_seed?: number | null
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playoff_bracket_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_bracket_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "league_matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_bracket_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_bracket_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_bracket_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_seed_picks: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          picked_at: string | null
          picked_opponent_id: string | null
          picking_seed: number
          picking_team_id: string
          round: number
          season: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          picked_at?: string | null
          picked_opponent_id?: string | null
          picking_seed: number
          picking_team_id: string
          round: number
          season: string
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          picked_at?: string | null
          picked_opponent_id?: string | null
          picking_seed?: number
          picking_team_id?: string
          round?: number
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_seed_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_seed_picks_picked_opponent_id_fkey"
            columns: ["picked_opponent_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_seed_picks_picking_team_id_fkey"
            columns: ["picking_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          id: string
          poll_id: string
          selections: Json
          team_id: string
          voted_at: string
        }
        Insert: {
          id?: string
          poll_id: string
          selections: Json
          team_id: string
          voted_at?: string
        }
        Update: {
          id?: string
          poll_id?: string
          selections?: Json
          team_id?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "commissioner_polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          favorite_league_id: string | null
          id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          email: string
          favorite_league_id?: string | null
          id?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          favorite_league_id?: string | null
          id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_favorite_league_id_fkey"
            columns: ["favorite_league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_boards: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          player_id: string
          rank: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          player_id: string
          rank: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          player_id?: string
          rank?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_boards_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "prospect_boards_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_news: {
        Row: {
          created_at: string
          description: string | null
          external_id: string
          id: string
          link: string
          published_at: string
          source: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          external_id: string
          id?: string
          link: string
          published_at: string
          source: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          external_id?: string
          id?: string
          link?: string
          published_at?: string
          source?: string
          title?: string
        }
        Relationships: []
      }
      prospect_news_mentions: {
        Row: {
          news_id: string
          player_id: string
        }
        Insert: {
          news_id: string
          player_id: string
        }
        Update: {
          news_id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_news_mentions_news_id_fkey"
            columns: ["news_id"]
            isOneToOne: false
            referencedRelation: "prospect_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_news_mentions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "prospect_news_mentions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          mute_all: boolean
          preferences: Json
          token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          mute_all?: boolean
          preferences?: Json
          token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          mute_all?: boolean
          preferences?: Json
          token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          function_name: string
          id: number
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          function_name: string
          id?: never
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          function_name?: string
          id?: never
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      subscription_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          league_id: string | null
          metadata: Json | null
          rc_event_id: string | null
          tier: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          league_id?: string | null
          metadata?: Json | null
          rc_event_id?: string | null
          tier: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          league_id?: string | null
          metadata?: Json | null
          rc_event_id?: string | null
          tier?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_answers: {
        Row: {
          id: string
          question_id: string
          response_id: string
          value: Json
        }
        Insert: {
          id?: string
          question_id: string
          response_id: string
          value: Json
        }
        Update: {
          id?: string
          question_id?: string
          response_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answers_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_questions: {
        Row: {
          created_at: string | null
          id: string
          options: Json | null
          prompt: string
          required: boolean
          sort_order: number
          survey_id: string
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          options?: Json | null
          prompt: string
          required?: boolean
          sort_order: number
          survey_id: string
          type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          options?: Json | null
          prompt?: string
          required?: boolean
          sort_order?: number
          survey_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "commissioner_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          id: string
          submitted_at: string | null
          survey_id: string
          team_id: string
        }
        Insert: {
          id?: string
          submitted_at?: string | null
          survey_id: string
          team_id: string
        }
        Update: {
          id?: string
          submitted_at?: string | null
          survey_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "commissioner_surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_seasons: {
        Row: {
          created_at: string | null
          final_standing: number | null
          id: string
          league_id: string
          losses: number | null
          playoff_result: string | null
          points_against: number | null
          points_for: number | null
          season: string
          team_id: string
          ties: number | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          final_standing?: number | null
          id?: string
          league_id: string
          losses?: number | null
          playoff_result?: string | null
          points_against?: number | null
          points_for?: number | null
          season: string
          team_id: string
          ties?: number | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          final_standing?: number | null
          id?: string
          league_id?: string
          losses?: number | null
          playoff_result?: string | null
          points_against?: number | null
          points_for?: number | null
          season?: string
          team_id?: string
          ties?: number | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_seasons_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_seasons_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          division: number | null
          id: string
          is_commissioner: boolean
          league_id: string
          logo_key: string | null
          losses: number | null
          name: string
          points_against: number
          points_for: number
          sleeper_roster_id: number | null
          streak: string
          ties: number
          tricode: string | null
          user_id: string | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          division?: number | null
          id?: string
          is_commissioner: boolean
          league_id: string
          logo_key?: string | null
          losses?: number | null
          name: string
          points_against?: number
          points_for?: number
          sleeper_roster_id?: number | null
          streak?: string
          ties?: number
          tricode?: string | null
          user_id?: string | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          division?: number | null
          id?: string
          is_commissioner?: boolean
          league_id?: string
          logo_key?: string | null
          losses?: number | null
          name?: string
          points_against?: number
          points_for?: number
          sleeper_roster_id?: number | null
          streak?: string
          ties?: number
          tricode?: string | null
          user_id?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_proposal_items: {
        Row: {
          draft_pick_id: string | null
          from_team_id: string
          id: string
          pick_swap_round: number | null
          pick_swap_season: string | null
          player_id: string | null
          proposal_id: string
          protection_threshold: number | null
          to_team_id: string
        }
        Insert: {
          draft_pick_id?: string | null
          from_team_id: string
          id?: string
          pick_swap_round?: number | null
          pick_swap_season?: string | null
          player_id?: string | null
          proposal_id: string
          protection_threshold?: number | null
          to_team_id: string
        }
        Update: {
          draft_pick_id?: string | null
          from_team_id?: string
          id?: string
          pick_swap_round?: number | null
          pick_swap_season?: string | null
          player_id?: string | null
          proposal_id?: string
          protection_threshold?: number | null
          to_team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_proposal_items_draft_pick_id_fkey"
            columns: ["draft_pick_id"]
            isOneToOne: false
            referencedRelation: "draft_picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposal_items_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposal_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "trade_proposal_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposal_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposal_items_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_proposal_teams: {
        Row: {
          drop_player_ids: string[] | null
          id: string
          proposal_id: string
          responded_at: string | null
          status: string
          team_id: string
        }
        Insert: {
          drop_player_ids?: string[] | null
          id?: string
          proposal_id: string
          responded_at?: string | null
          status?: string
          team_id: string
        }
        Update: {
          drop_player_ids?: string[] | null
          id?: string
          proposal_id?: string
          responded_at?: string | null
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_proposal_teams_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposal_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_proposals: {
        Row: {
          accepted_at: string | null
          completed_at: string | null
          counteroffer_of: string | null
          id: string
          league_id: string
          notes: string | null
          proposed_at: string
          proposed_by_team_id: string
          review_expires_at: string | null
          status: string
          trade_summary: Json | null
          transaction_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          completed_at?: string | null
          counteroffer_of?: string | null
          id?: string
          league_id: string
          notes?: string | null
          proposed_at?: string
          proposed_by_team_id: string
          review_expires_at?: string | null
          status?: string
          trade_summary?: Json | null
          transaction_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          completed_at?: string | null
          counteroffer_of?: string | null
          id?: string
          league_id?: string
          notes?: string | null
          proposed_at?: string
          proposed_by_team_id?: string
          review_expires_at?: string | null
          status?: string
          trade_summary?: Json | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_proposals_counteroffer_of_fkey"
            columns: ["counteroffer_of"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposals_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposals_proposed_by_team_id_fkey"
            columns: ["proposed_by_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "full_transaction_log"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "trade_proposals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "league_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_rumors: {
        Row: {
          created_at: string
          id: string
          league_id: string
          player_id: string
          proposal_id: string | null
          template: string
          trigger_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          player_id: string
          proposal_id?: string | null
          template: string
          trigger_type: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          player_id?: string
          proposal_id?: string | null
          template?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_rumors_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rumors_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "trade_rumors_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rumors_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_votes: {
        Row: {
          id: string
          proposal_id: string
          team_id: string
          vote: string
          voted_at: string
        }
        Insert: {
          id?: string
          proposal_id: string
          team_id: string
          vote: string
          voted_at?: string
        }
        Update: {
          id?: string
          proposal_id?: string
          team_id?: string
          vote?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_votes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          auto_renew: boolean | null
          created_at: string
          expires_at: string | null
          id: string
          payment_provider: string | null
          payment_provider_id: string | null
          period_type: string | null
          rc_customer_id: string | null
          rc_product_id: string | null
          starts_at: string
          status: string
          tier: string
          user_id: string
        }
        Insert: {
          auto_renew?: boolean | null
          created_at?: string
          expires_at?: string | null
          id?: string
          payment_provider?: string | null
          payment_provider_id?: string | null
          period_type?: string | null
          rc_customer_id?: string | null
          rc_product_id?: string | null
          starts_at?: string
          status?: string
          tier: string
          user_id: string
        }
        Update: {
          auto_renew?: boolean | null
          created_at?: string
          expires_at?: string | null
          id?: string
          payment_provider?: string | null
          payment_provider_id?: string | null
          period_type?: string | null
          rc_customer_id?: string | null
          rc_product_id?: string | null
          starts_at?: string
          status?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist_signups: {
        Row: {
          created_at: string | null
          email: string
          id: string
          source: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          source?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          source?: string | null
        }
        Relationships: []
      }
      waiver_claims: {
        Row: {
          bid_amount: number | null
          created_at: string | null
          drop_player_id: string | null
          id: string
          league_id: string
          player_id: string
          priority: number
          processed_at: string | null
          status: string
          team_id: string
        }
        Insert: {
          bid_amount?: number | null
          created_at?: string | null
          drop_player_id?: string | null
          id?: string
          league_id: string
          player_id: string
          priority?: number
          processed_at?: string | null
          status?: string
          team_id: string
        }
        Update: {
          bid_amount?: number | null
          created_at?: string | null
          drop_player_id?: string | null
          id?: string
          league_id?: string
          player_id?: string
          priority?: number
          processed_at?: string | null
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiver_claims_drop_player_id_fkey"
            columns: ["drop_player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "waiver_claims_drop_player_id_fkey"
            columns: ["drop_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_claims_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_claims_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "waiver_claims_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_claims_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      waiver_priority: {
        Row: {
          faab_remaining: number | null
          league_id: string
          priority: number
          team_id: string
        }
        Insert: {
          faab_remaining?: number | null
          league_id: string
          priority?: number
          team_id: string
        }
        Update: {
          faab_remaining?: number | null
          league_id?: string
          priority?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiver_priority_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_priority_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          created_at: string
          id: string
          player_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "watchlist_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      week_scores: {
        Row: {
          league_id: string
          schedule_id: string
          score: number
          team_id: string
          updated_at: string
        }
        Insert: {
          league_id: string
          schedule_id: string
          score?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          league_id?: string
          schedule_id?: string
          score?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_scores_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_scores_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "league_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      full_transaction_log: {
        Row: {
          created_at: string | null
          draft_pick_id: string | null
          league_id: string | null
          notes: string | null
          player_id: string | null
          team_from_id: string | null
          team_to_id: string | null
          transaction_id: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_transaction_items_draft_pick_id_fkey"
            columns: ["draft_pick_id"]
            isOneToOne: false
            referencedRelation: "draft_picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_stats"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "league_transaction_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_team_from_id_fkey"
            columns: ["team_from_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transaction_items_team_to_id_fkey"
            columns: ["team_to_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      player_season_stats: {
        Row: {
          avg_3pa: number | null
          avg_3pm: number | null
          avg_ast: number | null
          avg_blk: number | null
          avg_fga: number | null
          avg_fgm: number | null
          avg_fta: number | null
          avg_ftm: number | null
          avg_min: number | null
          avg_pf: number | null
          avg_pts: number | null
          avg_reb: number | null
          avg_stl: number | null
          avg_tov: number | null
          birthdate: string | null
          external_id_nba: string | null
          games_played: number | null
          name: string | null
          nba_draft_year: number | null
          nba_team: string | null
          player_id: string | null
          position: string | null
          rookie: boolean | null
          season_added: string | null
          status: string | null
          total_3pa: number | null
          total_3pm: number | null
          total_ast: number | null
          total_blk: number | null
          total_dd: number | null
          total_fga: number | null
          total_fgm: number | null
          total_fta: number | null
          total_ftm: number | null
          total_pf: number | null
          total_pts: number | null
          total_reb: number | null
          total_stl: number | null
          total_td: number | null
          total_tov: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      batch_update_matchup_scores: {
        Args: { p_updates: Json }
        Returns: undefined
      }
      batch_update_team_standings: {
        Args: { p_updates: Json }
        Returns: undefined
      }
      check_bidding_wars: {
        Args: { p_league_id: string; p_proposal_id: string }
        Returns: undefined
      }
      check_rate_limit: {
        Args: {
          p_function_name: string
          p_max_requests: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: Json
      }
      claim_imported_team: { Args: { team_id_input: string }; Returns: string }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      execute_draft_pick: {
        Args: {
          p_draft_id: string
          p_is_rookie_draft?: boolean
          p_league_id: string
          p_pick_number: number
          p_player_id: string
          p_player_position: string
          p_roster_slot: string
          p_team_id: string
        }
        Returns: Json
      }
      execute_trade_transfers: {
        Args: {
          p_league_id: string
          p_notes: string
          p_pick_moves: Json
          p_pick_swaps: Json
          p_player_moves: Json
          p_proposal_id: string
          p_proposed_by: string
          p_timestamp: string
          p_today: string
          p_week_start: string
        }
        Returns: string
      }
      get_conversations: {
        Args: { p_league_id: string; p_team_id: string }
        Returns: {
          created_at: string
          id: string
          last_message: string
          last_message_at: string
          last_message_team_name: string
          league_id: string
          other_team_name: string
          type: string
          unread_count: number
        }[]
      }
      get_draft_queue: {
        Args: { p_draft_id: string; p_league_id: string; p_team_id: string }
        Returns: {
          avg_3pa: number
          avg_3pm: number
          avg_ast: number
          avg_blk: number
          avg_fga: number
          avg_fgm: number
          avg_fta: number
          avg_ftm: number
          avg_min: number
          avg_pf: number
          avg_pts: number
          avg_reb: number
          avg_stl: number
          avg_tov: number
          birthdate: string
          external_id_nba: string
          games_played: number
          name: string
          nba_draft_year: number
          nba_team: string
          player_id: string
          position: string
          priority: number
          queue_id: string
          rookie: boolean
          season_added: string
          status: string
          total_3pa: number
          total_3pm: number
          total_ast: number
          total_blk: number
          total_dd: number
          total_fga: number
          total_fgm: number
          total_fta: number
          total_ftm: number
          total_pf: number
          total_pts: number
          total_reb: number
          total_stl: number
          total_td: number
          total_tov: number
        }[]
      }
      get_draft_room_init: { Args: { p_draft_id: string }; Returns: Json }
      get_league_roster_stats: {
        Args: { p_league_id: string }
        Returns: {
          avg_3pa: number
          avg_3pm: number
          avg_ast: number
          avg_blk: number
          avg_fga: number
          avg_fgm: number
          avg_fta: number
          avg_ftm: number
          avg_min: number
          avg_pf: number
          avg_pts: number
          avg_reb: number
          avg_stl: number
          avg_tov: number
          birthdate: string
          external_id_nba: string
          games_played: number
          name: string
          nba_draft_year: number
          nba_team: string
          player_id: string
          position: string
          rookie: boolean
          season_added: string
          status: string
          team_id: string
          total_3pa: number
          total_3pm: number
          total_ast: number
          total_blk: number
          total_dd: number
          total_fga: number
          total_fgm: number
          total_fta: number
          total_ftm: number
          total_pf: number
          total_pts: number
          total_reb: number
          total_stl: number
          total_td: number
          total_tov: number
        }[]
      }
      get_matchup_init: {
        Args: { p_date: string; p_league_id: string; p_team_id: string }
        Returns: Json
      }
      get_messages_page: {
        Args: {
          p_conversation_id: string
          p_cursor?: string
          p_cursor_id?: string
          p_limit?: number
        }
        Returns: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          poll_closes_at: string
          poll_is_anonymous: boolean
          poll_options: Json
          poll_question: string
          poll_show_live_results: boolean
          poll_type: string
          survey_closes_at: string
          survey_description: string
          survey_question_count: number
          survey_results_visibility: string
          survey_title: string
          team_id: string
          team_name: string
          trade_summary: Json
          type: string
        }[]
      }
      get_or_create_trade_conversation: {
        Args: {
          p_league_id: string
          p_proposal_id: string
          p_team_ids: string[]
        }
        Returns: string
      }
      get_poll_results: { Args: { p_poll_id: string }; Returns: Json }
      get_survey_results: { Args: { p_survey_id: string }; Returns: Json }
      get_team_roster_for_trade: {
        Args: { p_league_id: string; p_team_id: string }
        Returns: {
          avg_3pa: number
          avg_3pm: number
          avg_ast: number
          avg_blk: number
          avg_fga: number
          avg_fgm: number
          avg_fta: number
          avg_ftm: number
          avg_min: number
          avg_pf: number
          avg_pts: number
          avg_reb: number
          avg_stl: number
          avg_tov: number
          birthdate: string
          external_id_nba: string
          games_played: number
          name: string
          nba_draft_year: number
          nba_team: string
          player_id: string
          position: string
          rookie: boolean
          roster_slot: string
          season_added: string
          status: string
          total_3pa: number
          total_3pm: number
          total_ast: number
          total_blk: number
          total_dd: number
          total_fga: number
          total_fgm: number
          total_fta: number
          total_ftm: number
          total_pf: number
          total_pts: number
          total_reb: number
          total_stl: number
          total_td: number
          total_tov: number
        }[]
      }
      get_team_roster_stats: {
        Args: { p_league_id: string; p_team_id: string }
        Returns: {
          avg_3pa: number | null
          avg_3pm: number | null
          avg_ast: number | null
          avg_blk: number | null
          avg_fga: number | null
          avg_fgm: number | null
          avg_fta: number | null
          avg_ftm: number | null
          avg_min: number | null
          avg_pf: number | null
          avg_pts: number | null
          avg_reb: number | null
          avg_stl: number | null
          avg_tov: number | null
          birthdate: string | null
          external_id_nba: string | null
          games_played: number | null
          name: string | null
          nba_draft_year: number | null
          nba_team: string | null
          player_id: string | null
          position: string | null
          rookie: boolean | null
          season_added: string | null
          status: string | null
          total_3pa: number | null
          total_3pm: number | null
          total_ast: number | null
          total_blk: number | null
          total_dd: number | null
          total_fga: number | null
          total_fgm: number | null
          total_fta: number | null
          total_ftm: number | null
          total_pf: number | null
          total_pts: number | null
          total_reb: number | null
          total_stl: number | null
          total_td: number | null
          total_tov: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "player_season_stats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_total_unread: {
        Args: { p_league_id: string; p_team_id: string }
        Returns: number
      }
      get_user_tier: {
        Args: { p_league_id?: string; p_user_id: string }
        Returns: string
      }
      get_vault_secret: { Args: { secret_name: string }; Returns: string }
      get_week_score_data: {
        Args: { p_league_id: string; p_schedule_id: string }
        Returns: Json
      }
      increment_team_count: { Args: { league_id: string }; Returns: number }
      increment_team_stats: {
        Args: {
          p_losses: number
          p_pa: number
          p_pf: number
          p_team_id: string
          p_ties: number
          p_wins: number
        }
        Returns: undefined
      }
      is_league_commissioner: {
        Args: { p_league_id: string }
        Returns: boolean
      }
      is_league_member: { Args: { p_league_id: string }; Returns: boolean }
      is_team_present: {
        Args: { p_draft_id: string; p_team_id: string }
        Returns: boolean
      }
      is_trade_participant: {
        Args: { p_league_id: string; p_proposal_id: string }
        Returns: boolean
      }
      leak_trade_rumor: {
        Args: {
          p_league_id: string
          p_player_id: string
          p_player_name: string
          p_proposal_id: string
          p_team_id: string
          p_template: string
        }
        Returns: undefined
      }
      my_team_id: { Args: { p_league_id: string }; Returns: string }
      pgmq_archive: {
        Args: { msg_id: number; queue_name: string }
        Returns: boolean
      }
      pgmq_read: {
        Args: { qty?: number; queue_name: string; visibility_timeout?: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      pgmq_send: {
        Args: { message: Json; queue_name: string }
        Returns: number
      }
      ping_draft_presence: {
        Args: {
          p_draft_id: string
          p_reset_autopick?: boolean
          p_team_id: string
        }
        Returns: undefined
      }
      post_trade_update: {
        Args: {
          p_acting_team_id?: string
          p_event: string
          p_league_id: string
          p_proposal_id: string
          p_team_ids: string[]
          p_team_name?: string
        }
        Returns: string
      }
      refresh_player_season_stats: { Args: never; Returns: undefined }
      set_autopick: {
        Args: { p_draft_id: string; p_enabled: boolean; p_team_id: string }
        Returns: undefined
      }
      toggle_trade_block_interest: {
        Args: { p_league_id: string; p_player_id: string; p_team_id: string }
        Returns: boolean
      }
      transfer_team_ownership: {
        Args: {
          p_league_id: string
          p_new_owner_email: string
          p_team_id: string
        }
        Returns: Json
      }
      try_cast_uuid: { Args: { val: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
