-- Phase 2 / Stage B+: per-game plus-minus + secondary performer.
--
-- Game Score (Hollinger) is one signal of impact, but it under-weights
-- playmaking, perimeter defense, and gravity. Plus-minus catches some of
-- those gaps — a Haliburton-style playmaker who's +22 in a 3-point win
-- decided that game even with a modest stat line. We also store the
-- second-best player by Game Score per side so the UI can surface the
-- impactful role player (Gordon's defensive game, Nembhard locking up
-- Brunson) alongside the primary star.

BEGIN;

ALTER TABLE public.pro_playoff_game
  ADD COLUMN top_a_plus_minus int,
  ADD COLUMN top_b_plus_minus int,
  ADD COLUMN top_a_secondary_player_id   text,
  ADD COLUMN top_a_secondary_player_name text,
  ADD COLUMN top_a_secondary_stat_line   text,
  ADD COLUMN top_a_secondary_game_score  numeric(5,1),
  ADD COLUMN top_a_secondary_plus_minus  int,
  ADD COLUMN top_b_secondary_player_id   text,
  ADD COLUMN top_b_secondary_player_name text,
  ADD COLUMN top_b_secondary_stat_line   text,
  ADD COLUMN top_b_secondary_game_score  numeric(5,1),
  ADD COLUMN top_b_secondary_plus_minus  int;

COMMIT;
