-- The roster-cuts deadline is now the DEFINITIVE cutoff, and it survives the
-- start of the season.
--
-- Original design: the commissioner was blocked until rosters were legal, so
-- 20260730000100 let Start Season apply cuts on the spot and cleared the
-- deadline once the schedule was generated. Both are now wrong. The rule is:
--
--   * The commissioner is NEVER blocked — an over-cap roster may enter the
--     regular season (the app already tolerates exactly this state; imported
--     leagues start over cap and rely on the in-season over-cap lock).
--   * Nothing cuts a player before the deadline. Not the commissioner, not
--     starting the season. GMs own the decision until the date passes.
--   * The cron then makes the cuts on that date regardless of whether the
--     season has started.
--
-- That last point breaks the assumption 20260730000100 was built on. It skipped
-- the daily_lineups snapshot because "there is no live scoring week in the
-- offseason" — true then, false now. A mid-week drop must preserve the days the
-- player already played, or that week's scoring silently loses them (the
-- resolveSlot gap class: with no league_players row and no daily_lineups row,
-- there is nothing left to score from).
--
-- Two changes below:
--   1. enforce_team_roster_cuts snapshots the week like roster_add_drop does,
--      and places cut players on waivers instead of straight into free agency
--      (in a live season, an instant free agent is a vulture race; every other
--      drop path in the app goes through waivers).
--   2. generate_schedule_atomic stops clearing roster_cuts_deadline.

CREATE OR REPLACE FUNCTION public.enforce_team_roster_cuts(
  p_league_id uuid,
  p_team_id uuid,
  p_to_taxi uuid[],          -- planned stash order (newest-first)
  p_to_drop uuid[],          -- planned drop order (newest-first)
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        date;
  v_week_start   date;
  v_snapshot     date;
  v_size         integer;
  v_active       integer;
  v_taxi_seats   integer;
  v_taxi_used    integer;
  v_pid          uuid;
  v_slot         text;
  v_acquired     timestamptz;
  v_waiver_until timestamptz;
  v_stashed      uuid[] := '{}';
  v_dropped      uuid[] := '{}';
  v_txn_id       uuid;
BEGIN
  v_today := sport_slate_date();

  -- Serialize against concurrent GM moves and a racing second caller.
  PERFORM 1 FROM league_players
   WHERE league_id = p_league_id AND team_id = p_team_id
   FOR UPDATE;

  SELECT roster_size INTO v_size FROM leagues WHERE id = p_league_id;
  IF v_size IS NULL THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- NULL in the offseason (no schedule row covers today), which is what makes
  -- the snapshot below a no-op there and active in-season.
  SELECT start_date INTO v_week_start
    FROM league_schedule
   WHERE league_id = p_league_id AND start_date <= v_today AND end_date >= v_today
   LIMIT 1;

  SELECT count(*) INTO v_active
    FROM league_players
   WHERE league_id = p_league_id AND team_id = p_team_id
     AND coalesce(roster_slot, '') NOT IN ('IR', 'TAXI')
     AND acquired_at <= now();

  -- Already legal: the GM fixed it, or another caller won the race.
  IF v_active <= v_size THEN
    RETURN jsonb_build_object('skipped', true, 'active', v_active);
  END IF;

  -- Taxi seats come from league_roster_config, NOT leagues.taxi_slots:
  -- replace_roster_config rewrites the config rows and leagues.roster_size but
  -- never leagues.taxi_slots, and the roster page renders its taxi section from
  -- the config — so the config row is what GMs actually see.
  SELECT coalesce(
    (SELECT slot_count FROM league_roster_config
      WHERE league_id = p_league_id AND position = 'TAXI'),
    (SELECT taxi_slots FROM leagues WHERE id = p_league_id),
    0
  ) INTO v_taxi_seats;

  SELECT count(*) INTO v_taxi_used
    FROM league_players
   WHERE league_id = p_league_id AND team_id = p_team_id AND roster_slot = 'TAXI';

  -- Pass 1 — stash into open taxi seats.
  FOREACH v_pid IN ARRAY p_to_taxi LOOP
    EXIT WHEN v_active <= v_size OR v_taxi_used >= v_taxi_seats;

    UPDATE league_players
       SET roster_slot = 'TAXI', promoted_from_taxi = false
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = v_pid
       AND coalesce(roster_slot, '') NOT IN ('IR', 'TAXI');

    IF FOUND THEN
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, p_team_id, v_pid, v_today, 'TAXI')
      ON CONFLICT (team_id, player_id, lineup_date)
        DO UPDATE SET roster_slot = EXCLUDED.roster_slot;

      v_active := v_active - 1;
      v_taxi_used := v_taxi_used + 1;
      v_stashed := array_append(v_stashed, v_pid);
    END IF;
  END LOOP;

  -- Pass 2 — drop the remainder.
  FOREACH v_pid IN ARRAY p_to_drop LOOP
    EXIT WHEN v_active <= v_size;

    -- Read the slot + acquisition BEFORE deleting; both are needed to pin the
    -- week snapshot, and neither is recoverable afterwards.
    SELECT roster_slot, acquired_at INTO v_slot, v_acquired
      FROM league_players
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = v_pid
       AND coalesce(roster_slot, '') NOT IN ('IR', 'TAXI');
    CONTINUE WHEN NOT FOUND;

    -- Preserve days already played this week (in-season only — v_week_start is
    -- NULL in the offseason). Skipped when the player was acquired today: there
    -- are no prior days, and backfilling would invent a roster day.
    IF v_week_start IS NOT NULL THEN
      v_snapshot := GREATEST(v_week_start, sport_slate_date(v_acquired));
      IF v_snapshot < v_today THEN
        INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
        VALUES (p_league_id, p_team_id, v_pid, v_snapshot, coalesce(v_slot, 'BE'))
        ON CONFLICT (team_id, player_id, lineup_date) DO NOTHING;  -- keep a real lineup edit
      END IF;
    END IF;

    DELETE FROM league_players
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = v_pid
       AND coalesce(roster_slot, '') NOT IN ('IR', 'TAXI');

    IF FOUND THEN
      -- DROPPED sentinel from today onward; prior days stay scoreable.
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, p_team_id, v_pid, v_today, 'DROPPED')
      ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'DROPPED';

      DELETE FROM daily_lineups
       WHERE league_id = p_league_id AND team_id = p_team_id
         AND player_id = v_pid AND lineup_date > v_today;

      -- Waivers, not instant free agency. Mid-season this is the difference
      -- between a fair claim window and a vulture race; waiver_until() is the
      -- single source for the clear time (never re-derive it). NULL = the
      -- league has waivers off, so the player becomes a free agent as before.
      v_waiver_until := waiver_until(p_league_id);
      IF v_waiver_until IS NOT NULL THEN
        INSERT INTO league_waivers (league_id, player_id, on_waivers_until, dropped_by_team_id)
        VALUES (p_league_id, v_pid, v_waiver_until, p_team_id)
        ON CONFLICT DO NOTHING;
      END IF;

      v_active := v_active - 1;
      v_dropped := array_append(v_dropped, v_pid);
    END IF;
  END LOOP;

  -- The plan didn't cover the overage (roster changed under us). Roll this team
  -- back entirely rather than leave it half-cut; the caller replans once.
  IF v_active > v_size THEN
    RAISE EXCEPTION 'plan_stale: roster changed since the plan was computed'
      USING ERRCODE = 'P0001';
  END IF;

  -- Audit trail, shaped like commissioner_roster_action: stashes read as a move
  -- (from = to = the team), drops as a departure (to = NULL).
  INSERT INTO league_transactions (league_id, type, team_id, notes)
  VALUES (p_league_id, 'commissioner', p_team_id, p_notes)
  RETURNING id INTO v_txn_id;

  IF array_length(v_stashed, 1) > 0 THEN
    INSERT INTO league_transaction_items (transaction_id, player_id, team_from_id, team_to_id)
    SELECT v_txn_id, pid, p_team_id, p_team_id FROM unnest(v_stashed) AS pid;
  END IF;

  IF array_length(v_dropped, 1) > 0 THEN
    INSERT INTO league_transaction_items (transaction_id, player_id, team_from_id, team_to_id)
    SELECT v_txn_id, pid, p_team_id, NULL FROM unnest(v_dropped) AS pid;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'stashed', to_jsonb(v_stashed),
    'dropped', to_jsonb(v_dropped),
    'active', v_active,
    'transaction_id', v_txn_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enforce_team_roster_cuts(uuid, uuid, uuid[], uuid[], text) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_team_roster_cuts(uuid, uuid, uuid[], uuid[], text) FROM public;
REVOKE ALL ON FUNCTION public.enforce_team_roster_cuts(uuid, uuid, uuid[], uuid[], text) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Let the deadline outlive the offseason.
--
-- Unchanged from 20260730000000 except the claim UPDATE no longer nulls
-- roster_cuts_deadline: an over-cap roster may enter the season, and the cron
-- still owes it a cut on the deadline date.
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
  SET schedule_generated = true, offseason_step = NULL
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

GRANT EXECUTE ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) FROM anon, authenticated;
