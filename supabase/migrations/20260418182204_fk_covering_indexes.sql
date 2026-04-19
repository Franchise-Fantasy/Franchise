-- Covering indexes for every foreign key that lacked one (Supabase advisor
-- lint: unindexed_foreign_keys). Without a covering index, FK-based joins
-- and cascading deletes do sequential scans. Most tables here are small
-- today, so the indexes are cheap to maintain and future-proof the schema.

CREATE INDEX IF NOT EXISTS idx_activity_tokens_league_id ON public.activity_tokens (league_id);
CREATE INDEX IF NOT EXISTS idx_activity_tokens_matchup_id ON public.activity_tokens (matchup_id);
CREATE INDEX IF NOT EXISTS idx_activity_tokens_team_id ON public.activity_tokens (team_id);

CREATE INDEX IF NOT EXISTS idx_chat_members_last_read_message_id ON public.chat_members (last_read_message_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_team_id ON public.chat_messages (team_id);

CREATE INDEX IF NOT EXISTS idx_chat_pins_pinned_by ON public.chat_pins (pinned_by);

CREATE INDEX IF NOT EXISTS idx_chat_reactions_team_id ON public.chat_reactions (team_id);

CREATE INDEX IF NOT EXISTS idx_commissioner_polls_message_id ON public.commissioner_polls (message_id);

CREATE INDEX IF NOT EXISTS idx_commissioner_surveys_conversation_id ON public.commissioner_surveys (conversation_id);
CREATE INDEX IF NOT EXISTS idx_commissioner_surveys_team_id ON public.commissioner_surveys (team_id);

CREATE INDEX IF NOT EXISTS idx_draft_queue_player_id ON public.draft_queue (player_id);
CREATE INDEX IF NOT EXISTS idx_draft_queue_team_id ON public.draft_queue (team_id);

CREATE INDEX IF NOT EXISTS idx_draft_team_status_team_id ON public.draft_team_status (team_id);

CREATE INDEX IF NOT EXISTS idx_league_records_team_id ON public.league_records (team_id);

CREATE INDEX IF NOT EXISTS idx_league_transaction_items_draft_pick_id ON public.league_transaction_items (draft_pick_id);
CREATE INDEX IF NOT EXISTS idx_league_transaction_items_team_to_id ON public.league_transaction_items (team_to_id);

CREATE INDEX IF NOT EXISTS idx_leagues_champion_team_id ON public.leagues (champion_team_id);
CREATE INDEX IF NOT EXISTS idx_leagues_created_by ON public.leagues (created_by);

CREATE INDEX IF NOT EXISTS idx_pick_swaps_beneficiary_team_id ON public.pick_swaps (beneficiary_team_id);
CREATE INDEX IF NOT EXISTS idx_pick_swaps_counterparty_team_id ON public.pick_swaps (counterparty_team_id);
CREATE INDEX IF NOT EXISTS idx_pick_swaps_created_by_proposal_id ON public.pick_swaps (created_by_proposal_id);

CREATE INDEX IF NOT EXISTS idx_playoff_bracket_matchup_id ON public.playoff_bracket (matchup_id);

CREATE INDEX IF NOT EXISTS idx_profiles_favorite_league_id ON public.profiles (favorite_league_id);

CREATE INDEX IF NOT EXISTS idx_prospect_boards_player_id ON public.prospect_boards (player_id);

CREATE INDEX IF NOT EXISTS idx_subscription_events_league_id ON public.subscription_events (league_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON public.subscription_events (user_id);

CREATE INDEX IF NOT EXISTS idx_survey_responses_team_id ON public.survey_responses (team_id);

CREATE INDEX IF NOT EXISTS idx_team_seasons_league_id ON public.team_seasons (league_id);

CREATE INDEX IF NOT EXISTS idx_trade_proposal_items_draft_pick_id ON public.trade_proposal_items (draft_pick_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposal_items_to_team_id ON public.trade_proposal_items (to_team_id);

CREATE INDEX IF NOT EXISTS idx_trade_proposals_counteroffer_of ON public.trade_proposals (counteroffer_of);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_proposed_by_team_id ON public.trade_proposals (proposed_by_team_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_transaction_id ON public.trade_proposals (transaction_id);

CREATE INDEX IF NOT EXISTS idx_trade_rumors_player_id ON public.trade_rumors (player_id);
