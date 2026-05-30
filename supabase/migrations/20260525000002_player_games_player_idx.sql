-- player_games only had an index on (sport, game_date). Every per-player query
-- — usePlayerGameLog (single player) and the new useRosterGameLogs (batch
-- `player_id IN (...)` for the roster trend board) — filters on player_id and
-- orders by game_date desc, so it was scanning. This composite index serves
-- both access paths.
CREATE INDEX IF NOT EXISTS player_games_sport_player_date_idx
  ON public.player_games (sport, player_id, game_date DESC);
