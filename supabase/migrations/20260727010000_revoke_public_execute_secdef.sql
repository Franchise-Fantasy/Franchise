-- Strip the implicit PUBLIC EXECUTE grant from the three SECURITY DEFINER
-- functions that still carried it.
--
-- Postgres grants EXECUTE to the PUBLIC pseudo-role on every new function.
-- `REVOKE ... FROM anon, authenticated` does NOT remove that separate PUBLIC
-- grant, so 20260709000000_profile_email_lookup.sql's revoke left
-- profile_id_for_email reachable by unauthenticated callers — an account/email
-- enumeration hole via /rest/v1/rpc/profile_id_for_email.
--
-- profile_id_for_email is server-only (its sole caller is the send-league-invite
-- edge function via the service-role client), so it keeps postgres +
-- service_role and nothing else.
--
-- assign_initial_draft_slots and get_or_create_dm are legitimately client-called
-- and already hold explicit `authenticated` grants; they only lose the anon
-- reach they never needed. Both also gate on auth.uid() internally, so this is
-- defense in depth rather than a live fix.

REVOKE EXECUTE ON FUNCTION public.profile_id_for_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_dm(uuid, uuid, uuid) FROM PUBLIC;
