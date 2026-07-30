-- Roster cuts: make the deadline configurable at league creation.
--
-- `roster_cuts_deadline` (20260730000000) is a concrete date, which only works
-- as a setting AFTER the rookie draft has armed it. A commissioner configuring a
-- brand-new dynasty league is a full season away from its first rookie draft, so
-- a date picked in the wizard would be long stale by the time it mattered — and
-- the old `COALESCE(roster_cuts_deadline, …)` arming would have preserved that
-- past date, handing the enforcement cron a deadline that expired months ago and
-- cutting every over-cap team the morning after the draft with zero grace.
--
-- The durable, season-independent setting is the GRACE PERIOD: "teams have N
-- days after the rookie draft to get legal". That is what the wizard and the
-- commissioner settings now edit; the concrete date remains editable on its own
-- once a deadline is actually pending.
--
--   roster_cuts_grace_days = 14   → armed 14 days out at each rookie draft
--   roster_cuts_grace_days = NULL → automatic deadlines off for this league
--
-- DEFAULT 14 backfills every existing row, so current behavior is unchanged.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS roster_cuts_grace_days smallint DEFAULT 14;

-- Upper bound is a sanity rail, not a rule: 60 days is longer than any real
-- offseason gap between the rookie draft and opening night. 0 is legal and means
-- "cuts are due the day the rookie draft ends".
ALTER TABLE public.leagues
  DROP CONSTRAINT IF EXISTS leagues_roster_cuts_grace_days_check;
ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_roster_cuts_grace_days_check
  CHECK (roster_cuts_grace_days IS NULL OR roster_cuts_grace_days BETWEEN 0 AND 60);

COMMENT ON COLUMN public.leagues.roster_cuts_grace_days IS
  'Dynasty: days after the rookie draft completes that over-cap teams get to trim before automatic cuts run. Drives roster_cuts_deadline via arm_roster_cuts_deadline(). NULL = never arm a deadline automatically.';

-- Column-level grant maintenance (see 20260729000200_protect_leagues_sensitive_columns).
-- `authenticated` holds COLUMN-level SELECT on leagues, so a new column is
-- invisible to every client until it is listed here. Re-issued with
-- roster_cuts_grace_days appended; the 4 sensitive columns stay OUT.
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
  faab_tiebreak, roster_cuts_deadline, roster_cuts_grace_days
) ON public.leagues TO authenticated;

-- ---------------------------------------------------------------------------
-- One arming policy, three callers.
--
-- 20260730000000 inlined the same two-line UPDATE in execute_draft_pick,
-- execute_autodraft_pick and apply_offline_draft. Now that the expression reads
-- a config column and has to defend against a stale date, keep it in one place —
-- the three RPCs below just call this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arm_roster_cuts_deadline(p_league_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deadline date;
BEGIN
  UPDATE public.leagues
  SET offseason_step = 'rookie_draft_complete',
      roster_cuts_deadline = CASE
        -- A date already sitting in the future was set deliberately for THIS
        -- offseason (commissioner override, or a re-published offline draft
        -- re-arming an unchanged class) — never move it.
        WHEN roster_cuts_deadline > public.sport_slate_date() THEN roster_cuts_deadline
        -- Automatic deadlines are off for this league. Clear any leftover past
        -- date so it can't reach the enforcement cron.
        WHEN roster_cuts_grace_days IS NULL THEN NULL
        ELSE public.sport_slate_date() + roster_cuts_grace_days
      END
  WHERE id = p_league_id
  RETURNING roster_cuts_deadline INTO v_deadline;

  RETURN v_deadline;
END;
$$;

-- Internal helper: it carries no auth check of its own and is only ever called
-- by the three SECURITY DEFINER draft RPCs (which run as the owner and so reach
-- it regardless of these grants). REVOKE from PUBLIC as well as the named roles —
-- the implicit PUBLIC grant survives a role-only revoke and PUBLIC covers anon.
REVOKE ALL ON FUNCTION public.arm_roster_cuts_deadline(uuid) FROM public;
REVOKE ALL ON FUNCTION public.arm_roster_cuts_deadline(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_roster_cuts_deadline(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Re-point the three arming call sites at the helper.
-- Bodies are unchanged from 20260730000000 except the step-5 UPDATE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_draft_pick(
  p_draft_id uuid,
  p_pick_number integer,
  p_player_id uuid,
  p_league_id uuid,
  p_team_id uuid,
  p_roster_slot text,
  p_player_position text,
  p_is_rookie_draft boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_picks integer;
  v_next_pick integer;
  v_is_complete boolean;
  v_timestamp timestamptz := now();
  v_cuts_deadline date;
BEGIN
  -- 1. Record the pick
  UPDATE public.draft_picks
  SET player_id = p_player_id, selected_at = v_timestamp
  WHERE draft_id = p_draft_id AND pick_number = p_pick_number;

  -- 2. Add player to roster
  INSERT INTO public.league_players (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
  VALUES (
    p_league_id, p_player_id, p_team_id,
    CASE WHEN p_is_rookie_draft THEN 'rookie_draft' ELSE 'draft' END,
    v_timestamp, p_player_position, p_roster_slot
  );

  -- 3. Remove from all draft queues
  DELETE FROM public.draft_queue
  WHERE draft_id = p_draft_id AND player_id = p_player_id;

  -- 4. Advance draft
  v_next_pick := p_pick_number + 1;
  SELECT (rounds * picks_per_round) INTO v_total_picks
  FROM public.drafts WHERE id = p_draft_id;

  v_is_complete := v_next_pick > v_total_picks;

  UPDATE public.drafts
  SET current_pick_number = v_next_pick,
      current_pick_timestamp = v_timestamp,
      status = CASE WHEN v_is_complete THEN 'complete' ELSE status END
  WHERE id = p_draft_id;

  -- 5. If rookie draft complete, advance offseason + arm the roster cuts deadline
  IF v_is_complete AND p_is_rookie_draft THEN
    v_cuts_deadline := public.arm_roster_cuts_deadline(p_league_id);
  END IF;

  RETURN jsonb_build_object(
    'is_complete', v_is_complete,
    'next_pick_number', v_next_pick,
    'roster_cuts_deadline', v_cuts_deadline
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.execute_autodraft_pick(
  p_draft_id uuid,
  p_pick_number integer,
  p_player_id uuid,
  p_league_id uuid,
  p_team_id uuid,
  p_roster_slot text,
  p_player_position text,
  p_is_rookie_draft boolean,
  p_next_time_limit integer,
  p_used_queue_entry_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_picks integer;
  v_next_pick integer;
  v_is_complete boolean;
  v_timestamp timestamptz := now();
  v_cuts_deadline date;
BEGIN
  -- 1. Claim the pick — guarded so only an OPEN pick matches. Two concurrent
  --    deliveries (a late QStash timer racing the stalled-draft sweeper, or an
  --    autopick racing a human) serialize on this row lock; the loser matches
  --    0 rows and returns claimed=false without touching the roster.
  UPDATE public.draft_picks
  SET player_id = p_player_id, selected_at = v_timestamp, auto_drafted = true
  WHERE draft_id = p_draft_id AND pick_number = p_pick_number AND player_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  -- 2. Add player to roster
  INSERT INTO public.league_players (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
  VALUES (
    p_league_id, p_player_id, p_team_id,
    CASE WHEN p_is_rookie_draft THEN 'rookie_draft' ELSE 'draft' END,
    v_timestamp, p_player_position, p_roster_slot
  );

  -- 3. Remove this player from every team's queue (+ the consumed queue entry)
  DELETE FROM public.draft_queue
  WHERE draft_id = p_draft_id AND player_id = p_player_id;
  IF p_used_queue_entry_id IS NOT NULL THEN
    DELETE FROM public.draft_queue WHERE id = p_used_queue_entry_id;
  END IF;

  -- 4. Advance the draft, snapshotting the next pick's clock in the same txn
  v_next_pick := p_pick_number + 1;
  SELECT (rounds * picks_per_round) INTO v_total_picks
  FROM public.drafts WHERE id = p_draft_id;
  v_is_complete := v_next_pick > v_total_picks;

  UPDATE public.drafts
  SET current_pick_number = v_next_pick,
      current_pick_timestamp = v_timestamp,
      current_pick_time_limit = p_next_time_limit,
      status = CASE WHEN v_is_complete THEN 'complete' ELSE status END
  WHERE id = p_draft_id;

  -- 5. Rookie draft complete → advance offseason + arm the roster cuts deadline
  IF v_is_complete AND p_is_rookie_draft THEN
    v_cuts_deadline := public.arm_roster_cuts_deadline(p_league_id);
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'is_complete', v_is_complete,
    'next_pick_number', v_next_pick,
    'roster_cuts_deadline', v_cuts_deadline
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) FROM public;
REVOKE ALL ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) FROM anon, authenticated;

-- The 'reopen' branch still leaves roster_cuts_deadline alone: offseason_step
-- goes back to 'rookie_draft_pending', which the enforcement cron skips, and a
-- re-publish re-arms (keeping the same date, since it is still in the future).
CREATE OR REPLACE FUNCTION public.apply_offline_draft(
  p_draft_id uuid,
  p_league_id uuid,
  p_mode text,
  p_picks jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_picks integer;
  v_pick jsonb;
  v_count integer := 0;
  v_cuts_deadline date;
BEGIN
  -- Teardown (both modes): remove the players this draft previously drafted and
  -- clear its recorded picks. Matches on the picks currently stored on this
  -- draft, so nothing outside this draft is touched.
  DELETE FROM public.league_players
  WHERE league_id = p_league_id
    AND acquired_via = 'rookie_draft'
    AND player_id IN (
      SELECT player_id FROM public.draft_picks
      WHERE draft_id = p_draft_id AND player_id IS NOT NULL
    );

  UPDATE public.draft_picks
  SET player_id = NULL, selected_at = NULL
  WHERE draft_id = p_draft_id;

  IF p_mode = 'reopen' THEN
    UPDATE public.drafts
    SET status = 'unscheduled', current_pick_number = 1
    WHERE id = p_draft_id;

    UPDATE public.leagues
    SET offseason_step = 'rookie_draft_pending'
    WHERE id = p_league_id AND offseason_step = 'rookie_draft_complete';

    RETURN jsonb_build_object('mode', 'reopen', 'picks_recorded', 0);
  END IF;

  -- publish
  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_picks)
  LOOP
    UPDATE public.draft_picks
    SET player_id = (v_pick->>'player_id')::uuid, selected_at = now()
    WHERE draft_id = p_draft_id
      AND pick_number = (v_pick->>'pick_number')::integer;

    INSERT INTO public.league_players
      (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
    VALUES (
      p_league_id,
      (v_pick->>'player_id')::uuid,
      (v_pick->>'team_id')::uuid,
      'rookie_draft',
      now(),
      v_pick->>'position',
      v_pick->>'roster_slot'
    );
    v_count := v_count + 1;
  END LOOP;

  SELECT (rounds * picks_per_round) INTO v_total_picks
  FROM public.drafts WHERE id = p_draft_id;

  UPDATE public.drafts
  SET status = 'complete', current_pick_number = COALESCE(v_total_picks, 0) + 1
  WHERE id = p_draft_id;

  v_cuts_deadline := public.arm_roster_cuts_deadline(p_league_id);

  RETURN jsonb_build_object(
    'mode', 'publish',
    'picks_recorded', v_count,
    'roster_cuts_deadline', v_cuts_deadline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) TO service_role;
