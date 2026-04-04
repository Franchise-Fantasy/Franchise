-- Upgrade the composite index on teams(user_id, league_id) to UNIQUE.
-- This serves all RLS helper function lookups (is_league_member, my_team_id)
-- and enforces the one-team-per-user-per-league invariant at the DB level.

-- Drop the old non-unique composite index
DROP INDEX IF EXISTS idx_teams_user_league;

-- Drop the now-redundant single-column user_id index
-- (the composite (user_id, league_id) covers user_id-only lookups)
DROP INDEX IF EXISTS idx_teams_user_id;

-- Create the unique composite index
CREATE UNIQUE INDEX idx_teams_user_id_league_id
  ON teams (user_id, league_id)
  WHERE user_id IS NOT NULL;
