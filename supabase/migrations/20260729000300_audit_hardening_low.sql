-- Low-severity hardening batch from the 2026-07-29 production-readiness audit.

-- (1) player_season_stats is a materialized view (no RLS possible) that was
-- readable by `anon` over the REST API. The app requires auth to read player
-- stats, so anon never needs it — revoke. `authenticated` keeps its direct
-- grant (used app-wide for player averages).
REVOKE SELECT ON public.player_season_stats FROM anon;

-- (2) increment_team_count / decrement_team_count adjust leagues.current_teams.
-- Their internal guard blocks non-members, but a MEMBER could still call them
-- directly to inflate/zero their own league's team count (capacity griefing).
-- Nothing calls them directly from a client — they're PERFORMed inside
-- SECURITY DEFINER functions (join_league_team, which runs as owner) and by
-- delete-account via service_role. Revoke direct authenticated execute; the SD
-- callers (owner) and service_role are unaffected.
REVOKE EXECUTE ON FUNCTION public.increment_team_count(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_team_count(uuid) FROM authenticated;
