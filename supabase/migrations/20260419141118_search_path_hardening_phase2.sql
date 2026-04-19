-- First attempt: set search_path = '' on SECURITY DEFINER functions flagged
-- by the advisor. This breaks any function body with unqualified refs —
-- the immediate follow-up migration (20260419141156_search_path_hardening_phase2_fix.sql)
-- corrects all 5 to `search_path = public` within seconds of this one.
-- Kept as separate files so schema_migrations history matches what was
-- actually applied to the DB. On a fresh deploy, the broken state exists
-- only between these two migrations running back-to-back.

ALTER FUNCTION public.is_team_present(uuid, uuid)
  SET search_path = '';

ALTER FUNCTION public.batch_update_matchup_scores(jsonb)
  SET search_path = '';

ALTER FUNCTION public.batch_update_team_standings(jsonb)
  SET search_path = '';

ALTER FUNCTION public.get_week_score_data(uuid, uuid)
  SET search_path = '';

ALTER FUNCTION public.check_blocked_content()
  SET search_path = '';
