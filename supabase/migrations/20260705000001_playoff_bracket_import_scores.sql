-- Imported playoff brackets have no league_matchups row, so per-slot scores
-- have nowhere to live (the bracket view reads scores off the matchup join).
-- Give the slot its own optional score columns: live brackets leave them null
-- and keep reading the matchup join; imported brackets populate them directly.
alter table playoff_bracket add column if not exists team_a_score numeric;
alter table playoff_bracket add column if not exists team_b_score numeric;

comment on column playoff_bracket.team_a_score is
  'Slot-level score for imported brackets (no league_matchups row). Live brackets leave this null and read scores from the matchup join.';
