-- Cost-runaway protection. A bad actor (or a buggy automated client) can
-- otherwise mint unlimited leagues / teams in a tight loop and run up
-- Supabase storage, realtime channels, and notification dispatch costs.
-- These caps are enforced at the database level via triggers so no
-- write path (direct insert, RPC, edge fn with service_role) can bypass.
--
-- Limits:
--   - 10 leagues per user (leagues.created_by)
--   - 12 teams per user  (teams.user_id) — a user in 12 leagues with one
--     team each is possible; sized comfortably above realistic usage.
--
-- Triggers fire on INSERT for both tables, and on UPDATE of teams.user_id
-- (the claim flow transfers ownership from NULL → a real uid).

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
  WHERE created_by = NEW.created_by;

  IF v_count >= 10 THEN
    RAISE EXCEPTION
      'You have reached the maximum of 10 leagues per account. Delete or transfer commissioner of an existing league before creating another.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leagues_per_user_cap ON public.leagues;
CREATE TRIGGER leagues_per_user_cap
  BEFORE INSERT ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_league_creation_cap();


CREATE OR REPLACE FUNCTION public.enforce_team_ownership_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Only relevant when assigning an owner. Imports create unclaimed teams
  -- (user_id NULL); those are exempt until they're claimed.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- For UPDATE, only run if user_id is changing (or going from null → uid).
  IF TG_OP = 'UPDATE'
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM teams
  WHERE user_id = NEW.user_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_count >= 12 THEN
    RAISE EXCEPTION
      'You have reached the maximum of 12 teams per account.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_per_user_cap ON public.teams;
CREATE TRIGGER teams_per_user_cap
  BEFORE INSERT OR UPDATE OF user_id ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_team_ownership_cap();
