-- Follow-up to 20260516000002: three Category B functions are actually
-- called from client code (not just edge functions). The integration test
-- suite didn't cover those flows, so the lockdown missed them. Restore
-- authenticated EXECUTE so users can:
--
--   - View playoff archive's per-team rotation tab    (pro_archive_team_rotation)
--   - Create a team (post-create counter)             (increment_team_count)
--   - Submit a trade proposal (fire-and-forget hook)  (check_bidding_wars)
--
-- Found via a sweep of `supabase.rpc(...)` calls in the client codebase
-- after the lockdown deployed.

GRANT EXECUTE ON FUNCTION public.pro_archive_team_rotation(integer, text, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_team_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_bidding_wars(uuid, uuid) TO authenticated;
