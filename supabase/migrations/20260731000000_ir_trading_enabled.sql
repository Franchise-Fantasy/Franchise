-- IR player trading: per-league commissioner option.
--
-- OFF (the default) preserves today's behavior: the execute-trade edge function
-- hard-blocks any trade containing a player whose league_players.roster_slot is
-- 'IR'. ON lets IR players be included in trades; execute-trade always lands a
-- traded IR player on the receiving team's bench ('BE') — implicit activation
-- that counts against roster_size, with the existing pending_drops flow handling
-- a full roster. Enforcement lives entirely in execute-trade (execute time is
-- the single enforcement point for trades; the proposal RPCs stay slot-blind).
--
-- DEFAULT false backfills every existing row, so current leagues are unchanged;
-- the create-league and import wizards default their toggle ON for new leagues.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS ir_trading_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leagues.ir_trading_enabled IS
  'Allow players in IR slots to be included in trades. A traded IR player always lands on the receiving team''s bench (implicit activation; counts against roster_size). Enforced at execute time by the execute-trade edge function.';

-- Column-level grant maintenance (see 20260729000200_protect_leagues_sensitive_columns).
-- `authenticated` holds COLUMN-level SELECT on leagues, so a new column is
-- invisible to every client until it is listed here. Re-issued with
-- ir_trading_enabled appended; the 4 sensitive columns stay OUT.
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
  faab_tiebreak, roster_cuts_deadline, roster_cuts_grace_days,
  ir_trading_enabled
) ON public.leagues TO authenticated;
