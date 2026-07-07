-- Security review 2026-07-07 — HIGH: profiles.is_admin privilege escalation.
--
-- The "Users can manage own profile" policy is FOR ALL with USING/CHECK
-- (auth.uid() = id). RLS is row-level, not column-level, and `authenticated`
-- holds an UPDATE grant on every column, so any user could PATCH their own row
-- with {is_admin:true} and become an app-global admin (app_config writes /
-- "brick every client" lever, cross-league message_reports PII, dead_letter
-- alerts). Guard the privileged column with a BEFORE UPDATE trigger — only
-- service_role / migrations (postgres) may change it. The client never writes
-- is_admin, so ordinary profile updates are unaffected.
--
-- NOTE: SECURITY INVOKER (default) — the trigger must observe the *caller's*
-- role via current_user; SECURITY DEFINER would report the owner and defeat it.

CREATE OR REPLACE FUNCTION public.guard_profiles_is_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'is_admin can only be changed by an administrator';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_guard_is_admin ON public.profiles;
CREATE TRIGGER profiles_guard_is_admin
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_is_admin();
