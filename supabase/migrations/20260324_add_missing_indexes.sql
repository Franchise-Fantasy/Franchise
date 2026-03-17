-- Missing foreign key indexes on frequently queried columns
CREATE INDEX IF NOT EXISTS idx_league_matchups_away_team ON league_matchups(away_team_id);
CREATE INDEX IF NOT EXISTS idx_league_matchups_home_team ON league_matchups(home_team_id);
CREATE INDEX IF NOT EXISTS idx_daily_lineups_team ON daily_lineups(team_id);
CREATE INDEX IF NOT EXISTS idx_daily_lineups_league ON daily_lineups(league_id);
CREATE INDEX IF NOT EXISTS idx_daily_lineups_player ON daily_lineups(player_id);
CREATE INDEX IF NOT EXISTS idx_league_waivers_league ON league_waivers(league_id);
CREATE INDEX IF NOT EXISTS idx_league_waivers_dropped_by ON league_waivers(dropped_by_team_id);
CREATE INDEX IF NOT EXISTS idx_waiver_claims_league ON waiver_claims(league_id);
CREATE INDEX IF NOT EXISTS idx_waiver_claims_team ON waiver_claims(team_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_league ON trade_proposals(league_id);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_league ON pending_transactions(league_id);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_team ON pending_transactions(team_id);

-- Composite indexes for hot query patterns
-- finalize-week: lookup unfinalized matchups by schedule
CREATE INDEX IF NOT EXISTS idx_matchups_schedule_not_finalized
  ON league_matchups(schedule_id) WHERE is_finalized = false;

-- get-week-scores: daily_lineups by league+team+date (covers the main scoring query)
CREATE INDEX IF NOT EXISTS idx_daily_lineups_league_team_date
  ON daily_lineups(league_id, team_id, lineup_date DESC);

-- week_scores fast lookup by schedule
CREATE INDEX IF NOT EXISTS idx_week_scores_schedule
  ON week_scores(schedule_id);
