-- Verified hot-path indexes only. Most filter combos are already covered:
--   * league_matchups: (league_id, home_team_id) + (league_id, away_team_id)
--     + partial (schedule_id) WHERE is_finalized=false
--   * chat_messages: (conversation_id, created_at DESC, id DESC)
--   * waiver_claims: (league_id), (team_id), (player_id), and unique partial
--     (league_id, team_id, player_id) WHERE status='pending'
--
-- The one gap: league-wide "pending claims" queries from process-waivers
-- and the FreeAgentList claim count. Adding a narrow partial here.

CREATE INDEX IF NOT EXISTS idx_waiver_claims_league_pending
  ON public.waiver_claims (league_id)
  WHERE status = 'pending';
