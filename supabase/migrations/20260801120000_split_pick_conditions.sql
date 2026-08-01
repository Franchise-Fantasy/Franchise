-- Split the single "Pick Protections & Swaps" league option into two.
--
-- `pick_conditions_enabled` gated two unrelated dynasty trade mechanics behind
-- one switch: pick PROTECTIONS (a traded pick reverts to the sender if it lands
-- in the top N) and pick SWAPS (the right to swap draft slots with another
-- team). A commissioner who wants protections but not swaps — or the reverse —
-- had no way to say so. Both are enforced client-side only (the trade RPCs and
-- execute-trade never read the column), so this is purely a settings/UI split.
--
-- Backfill: both new columns inherit the old value, so every existing league
-- keeps exactly the behavior it has today.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS pick_protections_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pick_swaps_enabled boolean NOT NULL DEFAULT false;

UPDATE public.leagues
SET pick_protections_enabled = pick_conditions_enabled,
    pick_swaps_enabled = pick_conditions_enabled
WHERE pick_conditions_enabled;

COMMENT ON COLUMN public.leagues.pick_protections_enabled IS
  'Allow top-N pick protections on traded draft picks (dynasty only). Client-gated: the trade builder hides the protection shield and the draft hub hides protection stories when off.';
COMMENT ON COLUMN public.leagues.pick_swaps_enabled IS
  'Allow pick swap rights in trades (dynasty only). Client-gated: the trade builder hides the Swap chip and the draft hub hides swap rows/projection when off.';
COMMENT ON COLUMN public.leagues.pick_conditions_enabled IS
  'DEPRECATED — superseded by pick_protections_enabled + pick_swaps_enabled. Kept only so app builds shipped before the split keep reading/writing a valid column; sync_pick_conditions_legacy() keeps it equal to (protections OR swaps). Drop the column, the trigger and the function once those builds have rolled.';

-- Rollout bridge. Old binaries still `select`, `insert` and `update` the legacy
-- column, and a stale JS bundle can't be fixed for a user who hasn't taken the
-- OTA yet. This keeps all three columns consistent in both directions:
--   * a NEW client writes the two new columns  -> legacy is recomputed
--   * an OLD client writes only the legacy one -> both new columns follow it
-- Delete along with the column.
CREATE OR REPLACE FUNCTION public.sync_pick_conditions_legacy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  legacy_only boolean;
BEGIN
  legacy_only := CASE
    WHEN TG_OP = 'INSERT' THEN
      NEW.pick_conditions_enabled
      AND NOT (NEW.pick_protections_enabled OR NEW.pick_swaps_enabled)
    ELSE
      NEW.pick_conditions_enabled IS DISTINCT FROM OLD.pick_conditions_enabled
      AND NEW.pick_protections_enabled IS NOT DISTINCT FROM OLD.pick_protections_enabled
      AND NEW.pick_swaps_enabled IS NOT DISTINCT FROM OLD.pick_swaps_enabled
  END;

  IF legacy_only THEN
    NEW.pick_protections_enabled := NEW.pick_conditions_enabled;
    NEW.pick_swaps_enabled := NEW.pick_conditions_enabled;
  ELSE
    NEW.pick_conditions_enabled := NEW.pick_protections_enabled OR NEW.pick_swaps_enabled;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pick_conditions_legacy ON public.leagues;
CREATE TRIGGER trg_sync_pick_conditions_legacy
  BEFORE INSERT OR UPDATE OF pick_conditions_enabled, pick_protections_enabled, pick_swaps_enabled
  ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pick_conditions_legacy();

-- Column-level grant maintenance (see 20260729000200_protect_leagues_sensitive_columns).
-- `authenticated` holds COLUMN-level SELECT on leagues, so a new column is
-- invisible to every client until it is listed here. Re-issued with the two new
-- columns appended; the 4 sensitive columns stay OUT.
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
  ir_trading_enabled, pick_protections_enabled, pick_swaps_enabled
) ON public.leagues TO authenticated;
