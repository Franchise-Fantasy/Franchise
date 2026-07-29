-- Blocker/High: leagues_select granted SELECT to `authenticated` gated only on
-- `archived_at IS NULL` (no membership predicate), and authenticated held
-- table-level SELECT on ALL columns. So any logged-in user could read every
-- league's invite_code (join any private league) and every commissioner's
-- payment handles (venmo/cashapp/paypal). The row policy must STAY open —
-- non-members legitimately resolve a league by invite code / invitation before
-- joining — so protect the 4 sensitive columns at the COLUMN level and serve
-- them through membership-checked SECURITY DEFINER RPCs.
--
-- MAINTENANCE NOTE: this is a column-level grant. A NEW column added to
-- public.leagues is NOT readable by clients until it is added to the GRANT
-- list below. If a `.select()` starts failing with "permission denied for
-- column X", add X here (and to hooks/useLeague.ts) — keep the 4 sensitive
-- columns OUT of both.
REVOKE SELECT ON public.leagues FROM authenticated;
GRANT SELECT (
  id, name, created_by, max_future_seasons, created_at, commissioner, teams,
  private, roster_size, current_teams, season, regular_season_weeks,
  playoff_weeks, season_start_date, schedule_generated,
  trade_review_period_hours, trade_veto_type, trade_votes_to_veto,
  trade_deadline, rookie_draft_rounds, rookie_draft_order, lottery_draws,
  waiver_type, waiver_period_days, faab_budget, waiver_day_of_week,
  lottery_odds, playoff_teams, playoff_seeding_format, reseed_each_round,
  offseason_step, champion_team_id, lottery_date, lottery_status,
  pick_conditions_enabled, draft_pick_trading_enabled, buy_in_amount,
  imported_from, scoring_type, league_type, keeper_count, taxi_slots,
  taxi_max_experience, weekly_acquisition_limit, auto_rumors_enabled,
  tiebreaker_order, initial_draft_order, division_count, division_1_name,
  division_2_name, player_lock_type, position_limits, sport, combine_cup_week,
  archived_at, archived_by, rookie_pick_time_limit, waiver_priority_reset,
  faab_tiebreak
) ON public.leagues TO authenticated;

-- Join-by-code: a non-member must resolve a league from a code they typed, but
-- can no longer SELECT invite_code. This SD lookup does it and returns only the
-- id + name for routing — never the code back, and never other leagues' codes.
CREATE OR REPLACE FUNCTION public.resolve_invite_code(p_code text)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.id, l.name
  FROM public.leagues l
  WHERE l.invite_code = p_code AND l.archived_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_invite_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_invite_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_invite_code(text) TO authenticated;

-- Members-only read of the sensitive columns for the league-info / home / Basics
-- screens (commissioner shares the invite code; members see the dues handles).
CREATE OR REPLACE FUNCTION public.get_league_private_info(p_league_id uuid)
RETURNS TABLE(
  invite_code text,
  venmo_username text,
  cashapp_tag text,
  paypal_username text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- auth.uid() inside a SECURITY DEFINER fn is still the CALLER, so this checks
  -- the calling user's membership (not the definer's).
  IF NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;
  RETURN QUERY
    SELECT l.invite_code, l.venmo_username, l.cashapp_tag, l.paypal_username
    FROM public.leagues l
    WHERE l.id = p_league_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_league_private_info(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_league_private_info(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_league_private_info(uuid) TO authenticated;
