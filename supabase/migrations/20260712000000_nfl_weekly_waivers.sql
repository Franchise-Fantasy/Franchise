-- NFL waiver cadence: one weekly clear, not a rolling per-player timer.
--
-- Basketball plays most nights, so a dropped player sitting on the wire for
-- `waiver_period_days` and clearing at the next 5am-ET rollover is the right
-- model — the wire keeps churning because the games do.
--
-- Football plays once a week, and the whole league reacts to the same Sunday.
-- Every real NFL league therefore runs a WEEKLY waiver run: everyone dropped
-- during the week sits until one clear (Wednesday morning, by universal
-- convention — it gives GMs the Mon/Tue after the games to submit claims, and
-- lands before Thursday Night Football). A rolling N-day timer would instead
-- clear players at seven different moments during the week, and — worse —
-- would let a player dropped on Sunday clear BEFORE the Monday-night game,
-- turning the wire into a first-come free-for-all mid-week.
--
-- `waiver_until(league)` is now the single source of truth for "when does a
-- dropped player clear". Every writer of league_waivers.on_waivers_until calls
-- it: this file's roster_add_drop, plus (in TS) process-pending-transactions,
-- process-waivers, execute-trade, and the client's IR-activation drop. It is
-- deliberately ONE function rather than a SQL↔TS pair — the previous copies of
-- `nextSlateRollover() + (days - 1)` in four files were already a drift hazard.

-- ── waiver_until ────────────────────────────────────────────────────────────
-- NULL means "do not place on waivers" (no-waiver league, or a basketball
-- league with a 0-day period): the dropped player becomes an instant free agent.
--
-- SECURITY INVOKER on purpose: the SD roster RPCs that call it already run as
-- owner, service-role edge functions bypass RLS, and a GM calling it directly
-- can only read a league they can already SELECT. No new exposure.
CREATE OR REPLACE FUNCTION public.waiver_until(
  p_league_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_sport text;
  v_type  text;
  v_days  int;
  v_next  timestamptz;   -- the next 5am-ET rollover
  v_dow   int;           -- day-of-week that rollover lands on (0=Sun … 3=Wed)
BEGIN
  SELECT coalesce(sport, 'nba'), coalesce(waiver_type, 'none'), coalesce(waiver_period_days, 0)
    INTO v_sport, v_type, v_days
    FROM leagues
   WHERE id = p_league_id;

  IF NOT FOUND OR v_type = 'none' THEN
    RETURN NULL;
  END IF;

  v_next := next_slate_rollover(p_at);

  IF v_sport = 'nfl' THEN
    -- Roll forward to the first Wednesday-morning rollover. When the next
    -- rollover IS Wednesday's (i.e. the drop happened on the Tuesday slate),
    -- the offset is 0 and the player clears in the coming run. A drop made
    -- after Wednesday's clear waits for the following week's — which is the
    -- point: one run per week, everyone in it.
    -- NFL ignores waiver_period_days entirely; the wizard hides that stepper.
    v_dow := EXTRACT(DOW FROM (sport_slate_date(p_at) + 1))::int;
    RETURN v_next + make_interval(days => (3 - v_dow + 7) % 7);
  END IF;

  IF v_days <= 0 THEN
    RETURN NULL;
  END IF;

  RETURN v_next + make_interval(days => v_days - 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.waiver_until(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waiver_until(uuid, timestamptz) FROM public;
REVOKE ALL ON FUNCTION public.waiver_until(uuid, timestamptz) FROM anon;

-- ── roster_add_drop ─────────────────────────────────────────────────────────
-- Unchanged from 20260711000001 except:
--   * the waiver placement now calls waiver_until() instead of inlining
--     `rollover + (days - 1)`;
--   * the weekly-acquisition-limit window is anchored to the league's OWN
--     fantasy week (league_schedule) instead of date_trunc('week') — which is
--     Monday-anchored, and therefore wrong for NFL's Tue–Mon week: a Monday
--     add counted against the NEXT week's allowance while the current week was
--     still being played. Falls back to the Monday anchor when the league has
--     no schedule row for today (pre-schedule leagues, offseason).
CREATE OR REPLACE FUNCTION public.roster_add_drop(
  p_league_id uuid,
  p_team_id uuid,
  p_add_player_id uuid DEFAULT NULL,   -- NULL = pure drop
  p_drop_player_id uuid DEFAULT NULL,  -- NULL = pure add
  p_defer_add boolean DEFAULT false,   -- added player's game already started
  p_queue_drop boolean DEFAULT false,  -- dropped player's game already started
  p_group_id uuid DEFAULT NULL         -- ties both sides into one activity-feed card
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today            date;
  v_effective        date;    -- day the drop takes effect (today, or tomorrow if queued)
  v_rollover         timestamptz;
  v_week_start       date;
  v_snapshot         date;
  v_waiver_type      text;
  v_waiver_until     timestamptz;
  v_weekly_limit     int;
  v_adds_this_week   int;
  v_adds_since       timestamptz;
  v_drop_slot        text;
  v_drop_acquired    timestamptz;
  v_drop_name        text;
  v_add_name         text;
  v_add_position     text;
  v_acquired_at      timestamptz;
  v_txn_id           uuid;
  v_deferred         boolean := false;
BEGIN
  IF p_add_player_id IS NULL AND p_drop_player_id IS NULL THEN
    RAISE EXCEPTION 'nothing_to_do: pass an add, a drop, or both' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization. A user JWT must own the team; service_role (auth.uid() IS
  -- NULL — anon is revoked below) is trusted because the edge functions that
  -- call this do their own auth.
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM teams
        WHERE id = p_team_id AND league_id = p_league_id AND user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'not_authorized: you do not own this team' USING ERRCODE = '42501';
  END IF;

  SELECT waiver_type, weekly_acquisition_limit
    INTO v_waiver_type, v_weekly_limit
    FROM leagues WHERE id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_today     := sport_slate_date();
  v_rollover  := next_slate_rollover();
  v_effective := CASE WHEN p_queue_drop THEN v_today + 1 ELSE v_today END;

  -- The league's current fantasy week — used for both the drop snapshot and
  -- the weekly-add window below.
  SELECT start_date INTO v_week_start
    FROM league_schedule
   WHERE league_id = p_league_id AND start_date <= v_today AND end_date >= v_today
   LIMIT 1;

  -- ── DROP ────────────────────────────────────────────────────────────────
  IF p_drop_player_id IS NOT NULL THEN
    -- FOR UPDATE so two concurrent drops of the same player can't both proceed.
    SELECT roster_slot, acquired_at INTO v_drop_slot, v_drop_acquired
      FROM league_players
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_drop_player_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'player_not_on_roster' USING ERRCODE = 'P0002';
    END IF;
    v_drop_slot := coalesce(v_drop_slot, 'BE');
    SELECT name INTO v_drop_name FROM players WHERE id = p_drop_player_id;

    -- Preserve the days already played this week: pin the player's slot at the
    -- week's baseline so finalized/in-progress scoring still sees where they
    -- played. Skipped when they were acquired on the effective day itself —
    -- there are no prior days to preserve, and backfilling would create a ghost
    -- roster entry for a team the player was never on.
    IF v_week_start IS NOT NULL THEN
      v_snapshot := GREATEST(v_week_start, sport_slate_date(v_drop_acquired));
      IF v_snapshot < v_effective THEN
        INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
        VALUES (p_league_id, p_team_id, p_drop_player_id, v_snapshot, v_drop_slot)
        ON CONFLICT (team_id, player_id, lineup_date) DO NOTHING;  -- keep any real lineup edit
      END IF;
    END IF;

    -- DROPPED sentinel from the effective day onward, and clear anything beyond
    -- it, so the player vanishes from that day forward but stays on prior days.
    INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    VALUES (p_league_id, p_team_id, p_drop_player_id, v_effective, 'DROPPED')
    ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'DROPPED';

    DELETE FROM daily_lineups
     WHERE league_id = p_league_id AND team_id = p_team_id
       AND player_id = p_drop_player_id AND lineup_date > v_effective;

    IF p_queue_drop THEN
      -- The dropped player's game is underway: leave them on the roster for
      -- today's scoring and let process-pending-transactions execute the drop
      -- (and the waiver placement) at the rollover.
      INSERT INTO pending_transactions (
        league_id, team_id, player_id, target_player_id,
        action_type, execute_after, status, metadata
      ) VALUES (
        p_league_id, p_team_id, p_drop_player_id, p_drop_player_id,
        'drop', v_rollover, 'pending',
        jsonb_build_object('name', v_drop_name, 'group_id', p_group_id)
      );
    ELSE
      DELETE FROM league_players
       WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_drop_player_id;

      -- NULL = no-waiver league (or 0-day period): instant free agent.
      v_waiver_until := waiver_until(p_league_id);
      IF v_waiver_until IS NOT NULL THEN
        INSERT INTO league_waivers (league_id, player_id, on_waivers_until, dropped_by_team_id)
        VALUES (p_league_id, p_drop_player_id, v_waiver_until, p_team_id);
      END IF;

      INSERT INTO league_transactions (league_id, type, team_id, notes, group_id)
      VALUES (p_league_id, 'waiver', p_team_id, 'Dropped ' || coalesce(v_drop_name, 'player'), p_group_id)
      RETURNING id INTO v_txn_id;

      INSERT INTO league_transaction_items (transaction_id, player_id, team_from_id)
      VALUES (v_txn_id, p_drop_player_id, p_team_id);
    END IF;
  END IF;

  -- ── ADD ─────────────────────────────────────────────────────────────────
  IF p_add_player_id IS NOT NULL THEN
    -- Weekly acquisition cap. Enforced here rather than only in the client so a
    -- direct API call can't skip it. The window is the league's own fantasy
    -- week (Tue–Mon for NFL, Mon–Sun for basketball), falling back to the
    -- Monday-anchored calendar week when no schedule row covers today.
    IF v_weekly_limit IS NOT NULL THEN
      v_adds_since := CASE
        WHEN v_week_start IS NOT NULL
          THEN (v_week_start::timestamp + interval '5 hours') AT TIME ZONE 'America/New_York'
        ELSE (date_trunc('week', now() AT TIME ZONE 'UTC'))::timestamp AT TIME ZONE 'UTC'
      END;

      SELECT count(DISTINCT lt.id) INTO v_adds_this_week
        FROM league_transactions lt
        JOIN league_transaction_items li ON li.transaction_id = lt.id
       WHERE lt.league_id = p_league_id
         AND lt.team_id = p_team_id
         AND lt.type = 'waiver'
         AND li.team_to_id IS NOT NULL
         AND lt.created_at >= v_adds_since;

      IF v_adds_this_week >= v_weekly_limit THEN
        RAISE EXCEPTION 'weekly_limit_reached: limit=%', v_weekly_limit USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Roster size + per-position caps + pending-trade overflow. Runs AFTER the
    -- drop above, so it reads the roster the add will actually land on. If it
    -- raises, the drop rolls back with it.
    PERFORM assert_can_add_free_agent(p_league_id, p_team_id, p_add_player_id);

    -- Position comes from `players`, never from the client, so a doctored
    -- payload can't dodge a position limit.
    SELECT name, position INTO v_add_name, v_add_position FROM players WHERE id = p_add_player_id;
    IF v_add_name IS NULL THEN
      RAISE EXCEPTION 'player_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- A locked add is claimed now but revealed at the rollover. When it is
    -- paired with a queued drop, the add defers too — otherwise the new player
    -- would appear today while the dropped one lingers, putting the team over
    -- its roster size for a day.
    v_deferred    := p_defer_add OR p_queue_drop;
    v_acquired_at := CASE WHEN v_deferred THEN v_rollover ELSE now() END;

    INSERT INTO league_players (
      league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at
    ) VALUES (
      p_league_id, p_team_id, p_add_player_id, v_add_position, 'BE', 'free_agent', v_acquired_at
    );

    INSERT INTO league_transactions (league_id, type, team_id, notes, group_id)
    VALUES (p_league_id, 'waiver', p_team_id, 'Added ' || v_add_name || ' from free agency', p_group_id)
    RETURNING id INTO v_txn_id;

    INSERT INTO league_transaction_items (transaction_id, player_id, team_to_id)
    VALUES (v_txn_id, p_add_player_id, p_team_id);
  END IF;

  RETURN jsonb_build_object(
    'added',        p_add_player_id IS NOT NULL,
    'dropped',      p_drop_player_id IS NOT NULL,
    'deferred',     v_deferred,
    'queued_drop',  p_queue_drop AND p_drop_player_id IS NOT NULL,
    'add_name',     v_add_name,
    'drop_name',    v_drop_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.roster_add_drop(uuid, uuid, uuid, uuid, boolean, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.roster_add_drop(uuid, uuid, uuid, uuid, boolean, boolean, uuid) FROM public;
REVOKE ALL ON FUNCTION public.roster_add_drop(uuid, uuid, uuid, uuid, boolean, boolean, uuid) FROM anon;
