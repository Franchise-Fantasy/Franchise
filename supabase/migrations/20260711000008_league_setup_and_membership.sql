-- Atomic league setup, team join, division assignment, and imported-team claim.
--
-- Four separate half-state bugs, all from multi-step writes with no transaction.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. setup_league — everything a league needs to FUNCTION, after the row exists.
--
-- The create-league wizard inserted the league, then its roster config, then its
-- scoring settings, then the draft, then the picks — five commits, and the error
-- handling for the middle three was literally an alert saying "League created
-- but failed to save roster config" followed by carrying on. A league with no
-- roster config can't resolve a lineup slot; with no scoring settings nothing
-- can be scored. The user lands in a league that looks real and silently isn't.
--
-- The `leagues` INSERT itself deliberately stays in TypeScript. It has ~50
-- columns fed by the wizard's enum maps, and rebuilding that column list in SQL
-- would create exactly the drift CLAUDE.md warns about — a new league setting
-- would compile fine and silently stop being saved. Instead the client inserts
-- the league (one statement, atomic on its own) and then calls this to attach
-- everything else in one transaction. If this fails, the caller deletes the bare
-- league row — safe, because nothing else points at it yet.
CREATE OR REPLACE FUNCTION public.setup_league(
  p_league_id uuid,
  p_roster_config jsonb,                 -- [{position, slot_count}]
  p_scoring jsonb,                       -- [{stat_name, point_value, is_enabled, inverse}]
  p_draft jsonb,                         -- {season, rounds, picks_per_round, ...}
  p_initial_picks jsonb,                 -- [{season, round, slot_number, pick_number}]
  p_future_picks jsonb DEFAULT NULL      -- dynasty only
)
RETURNS uuid                             -- the new draft's id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: you did not create this league' USING ERRCODE = '42501';
  END IF;

  INSERT INTO league_roster_config (league_id, position, slot_count)
  SELECT p_league_id, r->>'position', (r->>'slot_count')::integer
    FROM jsonb_array_elements(p_roster_config) AS r;

  INSERT INTO league_scoring_settings (league_id, stat_name, point_value, is_enabled, inverse)
  SELECT p_league_id, r->>'stat_name', (r->>'point_value')::numeric,
         coalesce((r->>'is_enabled')::boolean, true),
         coalesce((r->>'inverse')::boolean, false)
    FROM jsonb_array_elements(p_scoring) AS r;

  INSERT INTO drafts (
    league_id, season, type, status, rounds, picks_per_round,
    time_limit, accelerate_after_round, accelerated_time_limit, draft_type
  ) VALUES (
    p_league_id,
    p_draft->>'season',
    'initial',
    'unscheduled',
    (p_draft->>'rounds')::integer,
    (p_draft->>'picks_per_round')::integer,
    (p_draft->>'time_limit')::integer,
    nullif(p_draft->>'accelerate_after_round', '')::integer,
    nullif(p_draft->>'accelerated_time_limit', '')::integer,
    p_draft->>'draft_type'
  )
  RETURNING id INTO v_draft_id;

  INSERT INTO draft_picks (league_id, draft_id, season, round, pick_number, slot_number)
  SELECT p_league_id, v_draft_id, p->>'season',
         (p->>'round')::integer, (p->>'pick_number')::integer, (p->>'slot_number')::integer
    FROM jsonb_array_elements(p_initial_picks) AS p;

  IF p_future_picks IS NOT NULL AND jsonb_array_length(p_future_picks) > 0 THEN
    INSERT INTO draft_picks (league_id, season, round, slot_number)
    SELECT p_league_id, p->>'season', (p->>'round')::integer, (p->>'slot_number')::integer
      FROM jsonb_array_elements(p_future_picks) AS p;
  END IF;

  RETURN v_draft_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. join_league_team — create a team and take a seat.
--
-- create-team.tsx inserted the team, THEN bumped leagues.current_teams, THEN
-- created the waiver_priority row, THEN tentatively claimed the join-order draft
-- slot. Each failure leaves a distinct kind of broken:
--   * no count bump  → the seat is occupied but the league thinks it's free, so
--     the next joiner gets the same waiver priority and the league never reaches
--     "full" (the draft-slot assignment that fires on full never runs).
--   * no waiver row  → the team can't place a claim or a FAAB bid, ever.
-- Now one transaction.
CREATE OR REPLACE FUNCTION public.join_league_team(
  p_league_id uuid,
  p_name text,
  p_tricode text,
  p_is_commissioner boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id       uuid;
  v_current       integer;
  v_max           integer;
  v_faab          integer;
  v_divisions     integer;
  v_manual_order  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized: sign in to join a league' USING ERRCODE = '42501';
  END IF;

  INSERT INTO teams (name, tricode, league_id, user_id, is_commissioner)
  VALUES (p_name, p_tricode, p_league_id, auth.uid(), p_is_commissioner)
  RETURNING id INTO v_team_id;

  -- Seat count and waiver priority have to move with the team row: the priority
  -- IS the seat number.
  PERFORM increment_team_count(p_league_id);

  SELECT current_teams, teams, faab_budget, division_count,
         initial_draft_order = 'manual'
    INTO v_current, v_max, v_faab, v_divisions, v_manual_order
    FROM leagues WHERE id = p_league_id;

  INSERT INTO waiver_priority (league_id, team_id, priority, faab_remaining)
  VALUES (p_league_id, v_team_id, v_current, coalesce(v_faab, 100));

  -- Tentatively claim the join-order draft slot so a commissioner testing solo
  -- sees their picks immediately. Overwritten when the league fills and the real
  -- order is drawn. Skipped for manual-order leagues, where assigning here would
  -- make the "Set Draft Order" gate think an order already exists.
  IF NOT v_manual_order AND v_current IS NOT NULL AND v_current >= 1 THEN
    UPDATE draft_picks
       SET current_team_id = v_team_id, original_team_id = v_team_id
     WHERE league_id = p_league_id
       AND slot_number = v_current
       AND current_team_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'team_id', v_team_id,
    'current_teams', v_current,
    'max_teams', v_max,
    'division_count', v_divisions
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. assign_team_divisions — split a full league into two divisions.
--
-- Was a per-team UPDATE in a loop: a failure half-way through left some teams in
-- division 1 and the rest with none. The client shuffles (Math.random can't run
-- in SQL); this applies the split.
CREATE OR REPLACE FUNCTION public.assign_team_divisions(
  p_league_id uuid,
  p_division_1_team_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE teams
     SET division = CASE WHEN id = ANY(p_division_1_team_ids) THEN 1 ELSE 2 END
   WHERE league_id = p_league_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. assign_imported_team — hand an imported roster to the member who claimed it.
--
-- TeamAssigner.handleAssign ran four writes and checked the error on only the
-- FIRST. So in the common failure the member's user_id was already stamped on the
-- imported team while their placeholder team was never deleted — the member owns
-- TWO teams, and the league's seat count is wrong. Worse, the unchecked writes
-- failed silently: the UI said "assigned" either way.
CREATE OR REPLACE FUNCTION public.assign_imported_team(
  p_league_id uuid,
  p_imported_team_id uuid,
  p_member_team_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can assign imported teams'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_user_id
    FROM teams WHERE id = p_member_team_id AND league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_team_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_imported_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'imported_team_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Move the member's waiver priority onto the team they're taking over. If the
  -- imported team already has one, keep it and drop the placeholder's — the old
  -- code updated blindly and would have tripped the (league_id, team_id) unique.
  IF EXISTS (SELECT 1 FROM waiver_priority
              WHERE league_id = p_league_id AND team_id = p_imported_team_id) THEN
    DELETE FROM waiver_priority
     WHERE league_id = p_league_id AND team_id = p_member_team_id;
  ELSE
    UPDATE waiver_priority SET team_id = p_imported_team_id
     WHERE league_id = p_league_id AND team_id = p_member_team_id;
  END IF;

  -- Claim the imported team and retire the placeholder. The member joined
  -- (current_teams++) and their empty team goes away, so the seat count is
  -- already correct — don't touch it.
  UPDATE teams
     SET user_id = v_user_id, sleeper_roster_id = NULL
   WHERE id = p_imported_team_id;

  DELETE FROM teams WHERE id = p_member_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_league(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.setup_league(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.setup_league(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM anon;

GRANT EXECUTE ON FUNCTION public.join_league_team(uuid, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_league_team(uuid, text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.join_league_team(uuid, text, text, boolean) FROM anon;

GRANT EXECUTE ON FUNCTION public.assign_team_divisions(uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_team_divisions(uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.assign_team_divisions(uuid, uuid[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.assign_imported_team(uuid, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_imported_team(uuid, uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.assign_imported_team(uuid, uuid, uuid) FROM anon;
