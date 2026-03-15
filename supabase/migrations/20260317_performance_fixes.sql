-- ============================================================
-- Performance fixes identified by Supabase advisors
-- ============================================================

-- 1. Add missing foreign key indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_player_id ON public.watchlist(player_id);
CREATE INDEX IF NOT EXISTS idx_week_scores_team_id ON public.week_scores(team_id);

-- 2. Fix RLS policy: use (select auth.uid()) to evaluate once per query, not per row
DROP POLICY IF EXISTS "Users manage own watchlist" ON public.watchlist;
CREATE POLICY "Users manage own watchlist"
  ON public.watchlist FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- 3. Drop unused indexes (confirmed unused by Supabase advisor monitoring)
DROP INDEX IF EXISTS idx_leagues_created_by;
DROP INDEX IF EXISTS idx_leagues_invite_code;
DROP INDEX IF EXISTS idx_leagues_champion_team_id;
DROP INDEX IF EXISTS idx_league_txn_items_draft_pick_id;
DROP INDEX IF EXISTS idx_league_txn_items_team_to_id;
DROP INDEX IF EXISTS idx_profiles_favorite_league_id;
DROP INDEX IF EXISTS idx_trade_proposal_items_draft_pick_id;
DROP INDEX IF EXISTS idx_trade_proposal_items_player_id;
DROP INDEX IF EXISTS idx_trade_proposal_items_to_team_id;
DROP INDEX IF EXISTS idx_trade_proposals_proposed_by_team_id;
DROP INDEX IF EXISTS idx_trade_proposals_transaction_id;
DROP INDEX IF EXISTS idx_chat_messages_team_id;
DROP INDEX IF EXISTS idx_commissioner_polls_message_id;
DROP INDEX IF EXISTS idx_pick_swaps_created_by_proposal_id;
DROP INDEX IF EXISTS idx_pick_swaps_beneficiary_team_id;
DROP INDEX IF EXISTS idx_pick_swaps_counterparty_team_id;
DROP INDEX IF EXISTS idx_playoff_bracket_matchup_id;
DROP INDEX IF EXISTS idx_team_seasons_league_id;
DROP INDEX IF EXISTS idx_chat_reactions_team_id;
