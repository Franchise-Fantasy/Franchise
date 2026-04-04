-- Optimize RLS helper functions to use (SELECT auth.uid()) pattern.
-- This ensures Postgres evaluates the JWT claim once per statement
-- instead of per-row, significantly reducing overhead on tables with
-- many rows (daily_lineups, league_players, draft_picks, etc.).

CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teams
    WHERE user_id = (SELECT auth.uid())
      AND league_id = p_league_id
  );
$$;

CREATE OR REPLACE FUNCTION public.my_team_id(p_league_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM teams
  WHERE user_id = (SELECT auth.uid())
    AND league_id = p_league_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_league_commissioner(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues
    WHERE id = p_league_id
      AND created_by = (SELECT auth.uid())
  );
$$;
