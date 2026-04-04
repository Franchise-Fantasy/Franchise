-- Add is_third_place flag to playoff_bracket for 3rd place games
ALTER TABLE playoff_bracket
  ADD COLUMN is_third_place boolean NOT NULL DEFAULT false;
