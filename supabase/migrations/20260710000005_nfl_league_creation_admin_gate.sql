-- NFL league creation is admin-gated during the internal test. League
-- creation is a direct client INSERT on `leagues` (app/create-league.tsx)
-- under RLS — there is no create-league RPC/edge fn — so the server-side
-- gate is a BEFORE INSERT trigger. It checks profiles.is_admin for
-- NEW.created_by (not auth.uid()) so service-role paths (imports, tests,
-- seeding) are judged by the owning account, not the caller.
--
-- To open NFL to everyone later: DROP TRIGGER leagues_nfl_admin_gate ON
-- public.leagues; (and remove the client-side is_admin tile filter).

CREATE OR REPLACE FUNCTION public.enforce_nfl_league_admin_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sport = 'nfl' AND NOT EXISTS (
    SELECT 1 FROM profiles pr
    WHERE pr.id = NEW.created_by AND pr.is_admin = true
  ) THEN
    RAISE EXCEPTION 'NFL leagues are in internal testing and not yet available'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_nfl_league_admin_gate() OWNER TO postgres;
-- Trigger functions aren't directly callable, but strip default EXECUTE
-- grants anyway per the SECURITY DEFINER lockdown convention.
REVOKE ALL ON FUNCTION public.enforce_nfl_league_admin_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leagues_nfl_admin_gate ON public.leagues;
CREATE TRIGGER leagues_nfl_admin_gate
  BEFORE INSERT ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_nfl_league_admin_gate();
