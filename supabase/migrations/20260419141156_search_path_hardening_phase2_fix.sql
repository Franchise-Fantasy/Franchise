-- Revert from empty to 'public'. All 5 functions use unqualified table
-- references in their bodies, so search_path='' breaks them at runtime.
-- 'public' still prevents search_path-injection attacks (no extension
-- shadows possible) but preserves the function body's lookup assumptions.

ALTER FUNCTION public.is_team_present(uuid, uuid)
  SET search_path = public;

ALTER FUNCTION public.batch_update_matchup_scores(jsonb)
  SET search_path = public;

ALTER FUNCTION public.batch_update_team_standings(jsonb)
  SET search_path = public;

ALTER FUNCTION public.get_week_score_data(uuid, uuid)
  SET search_path = public;

ALTER FUNCTION public.check_blocked_content()
  SET search_path = public;
