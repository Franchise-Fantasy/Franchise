-- Roster cuts deadline (dynasty rookie drafts).
--
-- Rookie drafts deliberately don't enforce roster size, so a dynasty team can
-- finish the offseason over its active cap. Teams are ALLOWED to sit over cap
-- through the offseason (the over-cap lock is the penalty — see
-- utils/roster/overCapShared.ts), but until now the commissioner could not start
-- the new season until every GM made cuts, so a single absent GM stalled the
-- whole league indefinitely.
--
-- `leagues.roster_cuts_deadline` is the date after which any still-over-cap team
-- is resolved automatically: taxi-eligible players are stashed into open taxi
-- seats first, then the newest remaining acquisitions are dropped, until the
-- active roster is legal. The enforcement itself lives in
-- 20260730000100_enforce_roster_cuts.sql + the enforce-roster-cuts edge function.
--
-- `date`, not `timestamptz`, matching the `trade_deadline` precedent: the
-- commissioner picks it with a DateField and a daily cron enforces it. Semantics
-- are "teams have THROUGH the deadline day" — the cron enforces the following
-- morning, after the 5am-ET slate rollover.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS roster_cuts_deadline date;

COMMENT ON COLUMN public.leagues.roster_cuts_deadline IS
  'Dynasty offseason: date through which over-cap teams may keep an oversized roster. Auto-armed 14 days out when the rookie draft completes; cleared when the season starts or once enforcement has run. NULL = no pending deadline.';

-- Column-level grant maintenance (see 20260729000200_protect_leagues_sensitive_columns).
-- `authenticated` holds COLUMN-level SELECT on leagues, so a new column is
-- invisible to every client until it is listed here. Re-issued verbatim with
-- roster_cuts_deadline appended; the 4 sensitive columns stay OUT.
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
  faab_tiebreak, roster_cuts_deadline
) ON public.leagues TO authenticated;

-- ---------------------------------------------------------------------------
-- Arm the deadline at rookie-draft completion.
--
-- The three RPCs below are the only writers of offseason_step =
-- 'rookie_draft_complete' (live pick, autopick, offline publish), so they are
-- the natural choke point — no trigger needed. COALESCE means a commissioner who
-- already set a date by hand is never clobbered. All three are
-- `SET search_path = ''`, so public.sport_slate_date() is fully qualified.
--
-- Each returns the armed date so the calling edge function can name it in the
-- draft-completion push instead of sending a second notification.
-- ---------------------------------------------------------------------------

-- Unchanged from 20260412_make_draft_pick_rpc.sql except step 5 + the return.
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
    UPDATE public.leagues
    SET offseason_step = 'rookie_draft_complete',
        roster_cuts_deadline = COALESCE(roster_cuts_deadline, public.sport_slate_date() + 14)
    WHERE id = p_league_id
    RETURNING roster_cuts_deadline INTO v_cuts_deadline;
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

-- Unchanged from 20260710000003_execute_autodraft_pick.sql except step 5 + the return.
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
    UPDATE public.leagues
    SET offseason_step = 'rookie_draft_complete',
        roster_cuts_deadline = COALESCE(roster_cuts_deadline, public.sport_slate_date() + 14)
    WHERE id = p_league_id
    RETURNING roster_cuts_deadline INTO v_cuts_deadline;
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'is_complete', v_is_complete,
    'next_pick_number', v_next_pick,
    'roster_cuts_deadline', v_cuts_deadline
  );
END;
$$;

-- Service-role / definer only. REVOKE from public AND from anon/authenticated:
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase's default
-- privileges grant it directly to anon/authenticated — stripping only one leaves
-- the other, so a client could still reach this SD function.
GRANT EXECUTE ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) FROM public;
REVOKE ALL ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) FROM anon, authenticated;

-- Unchanged from 20260718120000_drafts_offline_mode.sql except the publish
-- branch's leagues UPDATE + the return. The 'reopen' branch deliberately leaves
-- roster_cuts_deadline alone: offseason_step goes back to 'rookie_draft_pending',
-- which the enforcement cron skips, and a re-publish re-COALESCEs the same date.
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

  UPDATE public.leagues
  SET offseason_step = 'rookie_draft_complete',
      roster_cuts_deadline = COALESCE(roster_cuts_deadline, public.sport_slate_date() + 14)
  WHERE id = p_league_id
  RETURNING roster_cuts_deadline INTO v_cuts_deadline;

  RETURN jsonb_build_object(
    'mode', 'publish',
    'picks_recorded', v_count,
    'roster_cuts_deadline', v_cuts_deadline
  );
END;
$$;

-- Service-role only — reached exclusively by the offline-draft edge function,
-- which owns the commissioner check.
REVOKE ALL ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Clear the deadline when the season starts.
--
-- Unchanged from 20260710000004_generate_schedule_atomic.sql except the claim
-- UPDATE also nulls roster_cuts_deadline — once the season is underway the
-- in-season over-cap lock owns roster legality, and a stale deadline must never
-- reach the enforcement cron.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_schedule_atomic(
  p_league_id uuid,
  p_weeks jsonb,
  p_matchups jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed uuid;
  v_week_count integer;
  v_matchup_count integer;
BEGIN
  -- Optimistic claim: only one caller can flip false->true. A concurrent or
  -- retried call matches 0 rows and aborts before inserting anything.
  UPDATE leagues
  SET schedule_generated = true, offseason_step = NULL, roster_cuts_deadline = NULL
  WHERE id = p_league_id AND schedule_generated = false
  RETURNING id INTO v_claimed;

  IF v_claimed IS NULL THEN
    RAISE EXCEPTION 'schedule already generated for league %', p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Insert weeks, then matchups joined to the just-inserted week ids by
  -- week_number — all in one statement so the schedule_id resolution and both
  -- inserts share the claim's transaction.
  WITH ins_weeks AS (
    INSERT INTO league_schedule
      (league_id, week_number, start_date, end_date, is_playoff, is_double_week, season)
    SELECT
      p_league_id,
      (w->>'week_number')::integer,
      (w->>'start_date')::date,
      (w->>'end_date')::date,
      (w->>'is_playoff')::boolean,
      (w->>'is_double_week')::boolean,
      (w->>'season')::text
    FROM jsonb_array_elements(p_weeks) AS w
    RETURNING id, week_number
  ),
  ins_matchups AS (
    INSERT INTO league_matchups
      (league_id, schedule_id, week_number, home_team_id, away_team_id)
    SELECT
      p_league_id,
      iw.id,
      (m->>'week_number')::integer,
      (m->>'home_team_id')::uuid,
      (m->>'away_team_id')::uuid
    FROM jsonb_array_elements(p_matchups) AS m
    JOIN ins_weeks iw ON iw.week_number = (m->>'week_number')::integer
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM ins_weeks),
    (SELECT count(*) FROM ins_matchups)
  INTO v_week_count, v_matchup_count;

  RETURN jsonb_build_object(
    'week_count', v_week_count,
    'matchup_count', v_matchup_count
  );
END;
$$;

-- Service-role / definer only (the edge function owns the commissioner/all-
-- claimed auth check and calls with the service key). REVOKE from public AND
-- anon/authenticated — stripping only one leaves the other reachable.
GRANT EXECUTE ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) FROM anon, authenticated;
