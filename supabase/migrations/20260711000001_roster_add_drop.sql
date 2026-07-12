-- Atomic free-agent add / drop / add-and-drop.
--
-- The client ran these as up to nine independent commits (PlayerDetailModal +
-- utils/roster/addFreeAgent):
--
--   daily_lineups snapshot → DROPPED marker → delete future rows
--   → DELETE FROM league_players        ← the player is now GONE
--   → INSERT INTO league_waivers
--   → assert_can_add_free_agent(...)    ← this can still RAISE
--   → INSERT INTO league_players (the add)
--   → league_transactions + items (add side)
--   → league_transactions + items (drop side)
--
-- If the guard raised — roster full, per-position cap, or a TOCTOU loss to a
-- concurrent claim — the dropped player was already deleted and already sitting
-- on waivers, and the replacement never arrived. The team ended a man short and
-- there was no unwind path: another GM could claim the dropped player before the
-- user could re-add him. checkAddDropPreflight() narrowed the window but could
-- not close it (it validates against a roster it read a round-trip earlier).
--
-- Doing the whole thing in one transaction closes it, and re-orders the work so
-- the guard becomes exact rather than approximate:
--
--   the DROP is applied FIRST, then assert_can_add_free_agent runs against the
--   post-drop roster.
--
-- That is what the old code was *simulating* by passing dropPlayerId into
-- checkAddDropPreflight and filtering it out of the position count by hand (and
-- what process-waivers had to simulate too — the same bug bit us there). Now the
-- guard just reads the real roster. For a queued (locked-day) drop the guard is
-- equally exact: it already subtracts `pending_transactions` drops, and this
-- function inserts that row before calling it.
--
-- If the guard raises, the drop rolls back with it. The player stays on the
-- roster. That is the entire point.
--
-- Slate dates and the rollover timestamp are computed server-side via
-- sport_slate_date() / next_slate_rollover() — never passed in. Game-lock state
-- (which needs tip-off times the DB does not hold) stays in TS and arrives as
-- the p_defer_add / p_queue_drop booleans.

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
  v_waiver_days      int;
  v_weekly_limit     int;
  v_adds_this_week   int;
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

  SELECT waiver_type, waiver_period_days, weekly_acquisition_limit
    INTO v_waiver_type, v_waiver_days, v_weekly_limit
    FROM leagues WHERE id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_today     := sport_slate_date();
  v_rollover  := next_slate_rollover();
  v_effective := CASE WHEN p_queue_drop THEN v_today + 1 ELSE v_today END;

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
    SELECT start_date INTO v_week_start
      FROM league_schedule
     WHERE league_id = p_league_id AND start_date <= v_today AND end_date >= v_today
     LIMIT 1;

    IF FOUND THEN
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

      IF v_waiver_type IS NOT NULL AND v_waiver_type <> 'none' AND coalesce(v_waiver_days, 0) > 0 THEN
        INSERT INTO league_waivers (league_id, player_id, on_waivers_until, dropped_by_team_id)
        VALUES (
          p_league_id, p_drop_player_id,
          v_rollover + make_interval(days => v_waiver_days - 1),
          p_team_id
        );
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
    -- direct API call can't skip it. Window and shape match the client's count:
    -- 'waiver' transactions for this team, this Monday-anchored week, that
    -- actually added someone (an item with a destination team).
    IF v_weekly_limit IS NOT NULL THEN
      SELECT count(DISTINCT lt.id) INTO v_adds_this_week
        FROM league_transactions lt
        JOIN league_transaction_items li ON li.transaction_id = lt.id
       WHERE lt.league_id = p_league_id
         AND lt.team_id = p_team_id
         AND lt.type = 'waiver'
         AND li.team_to_id IS NOT NULL
         AND lt.created_at >= (date_trunc('week', now() AT TIME ZONE 'UTC'))::timestamp AT TIME ZONE 'UTC';

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

-- Callable by GMs (the function checks team ownership) and by service_role.
-- REVOKE from public AND anon — Postgres grants EXECUTE to PUBLIC on every new
-- function and Supabase's defaults grant it to anon/authenticated directly, so
-- stripping only one leaves the other reachable.
GRANT EXECUTE ON FUNCTION public.roster_add_drop(uuid, uuid, uuid, uuid, boolean, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.roster_add_drop(uuid, uuid, uuid, uuid, boolean, boolean, uuid) FROM public;
REVOKE ALL ON FUNCTION public.roster_add_drop(uuid, uuid, uuid, uuid, boolean, boolean, uuid) FROM anon;
