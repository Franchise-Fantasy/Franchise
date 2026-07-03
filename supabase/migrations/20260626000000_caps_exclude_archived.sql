-- Per-user caps must not count soft-deleted (archived) leagues / teams.
-- Leagues are archived, never hard-deleted (leagues.archived_at), and the
-- leagues_select RLS policy already hides archived leagues from every client
-- read. A user who archives a league to free a slot still hit the cap because
-- enforce_league_creation_cap() counted archived rows — so "delete an existing
-- league before creating another" didn't actually work. Exclude archived rows
-- from both caps so the soft-delete model is consistent end to end.

CREATE OR REPLACE FUNCTION public.enforce_league_creation_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM leagues
  WHERE created_by = NEW.created_by
    AND archived_at IS NULL;

  IF v_count >= 10 THEN
    RAISE EXCEPTION
      'You have reached the maximum of 10 leagues per account. Delete or transfer commissioner of an existing league before creating another.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Team cap: teams in an archived league are inert (the league's UI is gone),
-- so they shouldn't consume a user's 12-team budget either.
CREATE OR REPLACE FUNCTION public.enforce_team_ownership_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM teams t
  JOIN leagues l ON l.id = t.league_id
  WHERE t.user_id = NEW.user_id
    AND l.archived_at IS NULL
    AND t.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_count >= 12 THEN
    RAISE EXCEPTION
      'You have reached the maximum of 12 teams per account.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
