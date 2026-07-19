-- Lock down apply_offline_draft (follow-up to 20260718120000_drafts_offline_mode).
--
-- Postgres grants EXECUTE to PUBLIC by default on every new function, and PUBLIC
-- is inherited by anon + authenticated. The original migration only revoked from
-- anon/authenticated explicitly, which does NOT strip the blanket PUBLIC grant —
-- so a client could still call this SECURITY DEFINER RPC directly via PostgREST
-- and bypass the commissioner check the offline-draft edge function owns. Revoke
-- from PUBLIC so only the definer (postgres) and service_role can reach it.
REVOKE ALL ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) TO service_role;
