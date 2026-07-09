-- Case-insensitive email → user-id lookup, index-backed.
--
-- send-league-invite (and the existing transfer_team_ownership RPC) resolve an
-- email to a profile with LOWER(email) = LOWER(input). Without an index that is
-- a sequential scan of profiles; this functional index turns it into an index
-- probe as the user base grows. lower() is a pg_catalog built-in — NOT an
-- extensions function — so this carries none of the extensions-schema USAGE
-- hazard that a trigram/unaccent expression index would (see
-- 20260708000000_projections_engine_extensions_usage).
CREATE INDEX IF NOT EXISTS idx_profiles_lower_email
  ON public.profiles (lower(email));

-- Thin helper so the edge function can hit the functional index (PostgREST can't
-- express lower(email) = x through a column filter). Returns the matching user
-- id or NULL. SECURITY DEFINER to read profiles regardless of the caller, but it
-- reveals whether an email has an account, so it's kept off the client roles —
-- only the service-role edge function (and the definer owner) may call it.
CREATE OR REPLACE FUNCTION public.profile_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.profile_id_for_email(text) FROM anon, authenticated;
