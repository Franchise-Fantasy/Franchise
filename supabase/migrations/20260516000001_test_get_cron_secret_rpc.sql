-- Test-only RPC that returns the CRON_SECRET to service-role callers.
-- vault.decrypted_secrets isn't exposed via PostgREST, so integration tests
-- that need to authenticate against cron-gated edge functions (finalize-week,
-- process-waivers, etc.) read the secret through this RPC instead of
-- duplicating it into .env.local.
--
-- Security: REVOKE EXECUTE from anon/authenticated. Only service_role
-- (which already has unrestricted DB access including vault directly via
-- SQL) can call it. No new attack surface.

CREATE OR REPLACE FUNCTION public.test_get_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';
  RETURN v_secret;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.test_get_cron_secret() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_get_cron_secret() TO service_role;
