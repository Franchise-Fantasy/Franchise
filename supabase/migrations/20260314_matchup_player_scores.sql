-- Store per-player scoring breakdowns in finalized matchups
-- so historical detail views work even after players are dropped.
ALTER TABLE league_matchups
  ADD COLUMN home_player_scores jsonb,
  ADD COLUMN away_player_scores jsonb;
