-- Roster-cuts enforcement: make ONE team's active roster legal, atomically.
--
-- Companion to leagues.roster_cuts_deadline (20260730000000). The
-- enforce-roster-cuts edge function computes the plan with the shared pure
-- utils/roster/rosterCutsShared.ts (so the GM's banner warning and the action
-- taken can never disagree) and hands the resulting ordered player_id arrays
-- here. This RPC applies them in one transaction.
--
-- Why one RPC instead of looping apply_roster_move + commissioner_roster_action:
-- per-TEAM atomicity is the thing that matters. A half-applied team means players
-- dropped without the taxi stash that should have saved them, and there is no
-- undo for a drop. League-level atomicity does NOT matter — the edge function
-- runs per-team with its own try/catch and counters, per cron convention.
--
-- Race safety: the loops are SELF-LIMITING. Every iteration re-checks the live
-- active count and every write is guarded on the row still being active, so this
-- can never cut more than necessary — not if a GM drops someone mid-run, not if
-- the cron and the commissioner's Start Season tap arrive together. Whoever
-- arrives second finds the roster already legal and no-ops. If the plan turns out
-- to be stale (it couldn't reach the cap with the players it was given), the
-- whole team rolls back and the caller replans.
--
-- Two deliberate divergences from the normal GM drop path, both because this runs
-- in the OFFSEASON:
--   * snapshotBeforeDrop is not used. It exists to preserve a partially-played
--     scoring week, and it early-returns when today falls in no league_schedule
--     week — definitionally true here. The `daily_lineups >= today` delete below
--     mirrors commissioner force_drop instead.
--   * No league_waivers row: cut players go straight to free agency, following
--     force_drop. Free-agent adds are gated during the offseason so a waiver
--     period would be theater, and advance_season_atomic wipes league_waivers at
--     the next rollover anyway. If this is ever revisited, call the waiver_until()
--     RPC — never re-derive that date.
--
-- Service-role only; the edge function owns both auth paths (cron secret and the
-- commissioner JWT check).
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
  v_today      date;
  v_size       integer;
  v_active     integer;
  v_taxi_seats integer;
  v_taxi_used  integer;
  v_pid        uuid;
  v_stashed    uuid[] := '{}';
  v_dropped    uuid[] := '{}';
  v_txn_id     uuid;
BEGIN
  v_today := sport_slate_date();

  -- Serialize against concurrent GM moves and a second enforcement caller.
  PERFORM 1 FROM league_players
   WHERE league_id = p_league_id AND team_id = p_team_id
   FOR UPDATE;

  SELECT roster_size INTO v_size FROM leagues WHERE id = p_league_id;
  IF v_size IS NULL THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0002';
  END IF;

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
  -- replace_roster_config (the commissioner's Edit Roster save) rewrites the
  -- config rows and leagues.roster_size but never leagues.taxi_slots, and the
  -- roster page renders its taxi section from the config — so the config row is
  -- what GMs actually see. Fall back to the column for older leagues.
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

    DELETE FROM league_players
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = v_pid
       AND coalesce(roster_slot, '') NOT IN ('IR', 'TAXI');

    IF FOUND THEN
      DELETE FROM daily_lineups
       WHERE team_id = p_team_id AND player_id = v_pid AND lineup_date >= v_today;

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

-- Service-role only. All three revokes are required: Postgres grants EXECUTE to
-- PUBLIC on every new function and Supabase's default privileges grant it to
-- anon/authenticated, so stripping one still leaves the function reachable.
GRANT EXECUTE ON FUNCTION public.enforce_team_roster_cuts(uuid, uuid, uuid[], uuid[], text) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_team_roster_cuts(uuid, uuid, uuid[], uuid[], text) FROM public;
REVOKE ALL ON FUNCTION public.enforce_team_roster_cuts(uuid, uuid, uuid[], uuid[], text) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Daily driver.
--
-- 10:25 UTC: after the 5am-ET slate rollover in both DST regimes (so "today"
-- is the real league day), and 10 minutes behind enqueue-process-waivers
-- (10:15) so it never races waiver resolution. The function sends the T-3 and
-- day-of warning pushes on the same pass and enforces the morning AFTER the
-- deadline day, so teams get the whole deadline day to fix it themselves.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'enforce-roster-cuts',
  '25 10 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/enforce-roster-cuts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Register with the cron watchdog so a silent failure surfaces as a dead-letter
-- alert instead of a league quietly never being enforced.
INSERT INTO public.cron_job_runs (job_name, expected_interval)
VALUES ('enforce-roster-cuts', interval '1 day')
ON CONFLICT (job_name) DO UPDATE SET expected_interval = EXCLUDED.expected_interval;
