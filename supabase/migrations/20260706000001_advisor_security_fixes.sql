-- Supabase security-advisor fixes (idempotent).
--
-- Root cause for the anon-executable SECURITY DEFINER lints: the flagged
-- functions still carry the default `EXECUTE` grant to `PUBLIC` (and in a couple
-- cases an explicit `anon` grant), so anon/authenticated can reach them through
-- PUBLIC. This happened because several were DROP/CREATE-recreated with a NEW
-- signature (e.g. assert_can_add_free_agent went (uuid,uuid) -> (uuid,uuid,uuid)
-- in 20260607000001), which re-applies Postgres's default PUBLIC grant, and the
-- prior lockdown REVOKEs targeted the OLD signatures. We re-lock the CURRENT
-- signatures here. Precedent: 20260516000002_lockdown_security_definer_grants.
--
-- Verified current signatures + grantees via information_schema before writing.

-- Client-callable RPCs: keep `authenticated` (+ service_role), drop PUBLIC/anon.
REVOKE EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) TO authenticated, service_role;

-- Internal helpers (only PERFORM'd by definer callers / called with the service
-- role by cron + edge functions): strip every client-reachable grant.
--   dedup_active_lineup_slots — finalize-week (service role) + hourly cron
--   execute_draft_pick        — make-draft-pick edge fn (service role)
--   prune_player_news         — poll-news-google edge fn (service role)
REVOKE EXECUTE ON FUNCTION public.dedup_active_lineup_slots(date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_player_news(integer, integer) FROM PUBLIC, anon, authenticated;

-- Pin the mutable search_path on the SQL↔TS paired helper (SECURITY INVOKER).
-- Body/logic unchanged — this only sets the function attribute, preserving the
-- position_limit_match_keys parity with rosterSlotsShared.ts. It has unqualified
-- refs, so `public` (not '') per the search_path-hardening rule.
ALTER FUNCTION public.position_limit_match_keys(text) SET search_path = public;
