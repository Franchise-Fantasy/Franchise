-- Phase 2 / Stage B: per-game headline performances on pro_playoff_game.
--
-- Stores the top performer per side per game, keyed by Game Score (Hollinger
-- formula) rather than raw points — Game Score weights rebounds, assists,
-- steals, blocks, FG efficiency, and turnovers, so it picks the player who
-- ACTUALLY decided the game rather than just the highest scorer.
--
-- Sourced from NBA's official Stats API (stats.nba.com/stats/...). Player
-- IDs in top_a_player_id / top_b_player_id are NBA Stats player IDs (not
-- Basketball-Reference slugs) — they're stored for future hyperlink/lookup
-- but not currently consumed by the UI.
--
-- The existing pro_archive_bracket RPC uses to_jsonb(g) to serialise game
-- rows, so these new columns flow through automatically with no RPC change.

BEGIN;

ALTER TABLE public.pro_playoff_game
  ADD COLUMN top_a_player_id   text,
  ADD COLUMN top_a_player_name text,
  ADD COLUMN top_a_stat_line   text, -- e.g. "32 PTS · 14 REB · 11 AST"
  ADD COLUMN top_a_game_score  numeric(5,1),
  ADD COLUMN top_b_player_id   text,
  ADD COLUMN top_b_player_name text,
  ADD COLUMN top_b_stat_line   text,
  ADD COLUMN top_b_game_score  numeric(5,1);

COMMIT;
