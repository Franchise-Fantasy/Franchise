-- Re-draw the draft order whenever the board is rebuilt.
--
-- Bug: a commissioner who changes the league size ends up with a draft where
-- no pick belongs to anybody. EditBasicsModal's resize calls
-- replace_draft_picks, which DELETEs every draft pick and re-inserts a fresh
-- board with NULL current_team_id / original_team_id. Nothing then re-draws
-- the order: assign_initial_draft_slots runs only when a member JOINS
-- (app/create-team.tsx), and the "am I full?" check it gates on had already
-- failed for good at the last join. So the classic case — a 12-team league
-- where only 8 people showed up, shrunk to 8 so it's finally "full" — lands on
-- a full league with an entirely unowned board. Scheduling succeeds, start-draft
-- succeeds, and the draft opens with nobody on the clock.
--
-- The draw moves into an internal helper so replace_draft_picks can run it in
-- the SAME transaction as the rebuild (a board can never be left unowned by a
-- half-failed call) without inheriting assign_initial_draft_slots' membership
-- check — that function is client-called and needs auth.uid(), while
-- replace_draft_picks is also granted to service_role, where is_league_member
-- is always false.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The draw itself. Body lifted verbatim from assign_initial_draft_slots
--    (20260801000000) minus its membership check; all of its no-op guards are
--    what make it safe to call from anywhere: it does nothing unless the league
--    is full, the order isn't manual, the league isn't in an offseason (that
--    order is deliberate — drawn by the lottery or by
--    create_season_draft_atomic), and the draft hasn't started.
--
--    No auth check of its own → internal only. Revoked from anon + authenticated
--    AND from PUBLIC (which covers anon on its own), leaving the SECURITY
--    DEFINER callers below and service_role.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draw_initial_draft_slots(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order text;
  v_league_size int;
  v_season text;
  v_step text;
  v_team_count int;
  v_draft_id uuid;
  v_team_ids uuid[];
BEGIN
  SELECT initial_draft_order, teams, season, offseason_step
    INTO v_order, v_league_size, v_season, v_step
  FROM leagues WHERE id = p_league_id;

  IF v_step IS NOT NULL THEN RETURN; END IF;              -- offseason order is deliberate
  IF v_order = 'manual' THEN RETURN; END IF;              -- commissioner sets order manually

  SELECT count(*) INTO v_team_count FROM teams WHERE league_id = p_league_id;
  IF v_team_count < v_league_size THEN RETURN; END IF;    -- not full yet

  SELECT id INTO v_draft_id
  FROM drafts
  WHERE league_id = p_league_id AND type = 'initial' AND season = v_season
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_draft_id IS NULL THEN RETURN; END IF;

  -- Never reshuffle a draft that has already started.
  IF EXISTS (SELECT 1 FROM draft_picks WHERE draft_id = v_draft_id AND selected_at IS NOT NULL) THEN
    RETURN;
  END IF;

  -- One shuffle, reused for the initial draft picks and the future-season
  -- placeholder picks so both share the same slot order.
  SELECT array_agg(id ORDER BY random()) INTO v_team_ids
  FROM teams WHERE league_id = p_league_id;

  UPDATE draft_picks dp
  SET current_team_id = v_team_ids[dp.slot_number],
      original_team_id = v_team_ids[dp.slot_number]
  WHERE dp.draft_id = v_draft_id
    AND dp.slot_number BETWEEN 1 AND array_length(v_team_ids, 1);

  UPDATE draft_picks dp
  SET current_team_id = v_team_ids[dp.slot_number],
      original_team_id = v_team_ids[dp.slot_number]
  WHERE dp.league_id = p_league_id
    AND dp.draft_id IS NULL
    AND dp.slot_number BETWEEN 1 AND array_length(v_team_ids, 1);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.draw_initial_draft_slots(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.draw_initial_draft_slots(uuid) FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The client-callable wrapper keeps its membership check and delegates.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_initial_draft_slots(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  PERFORM draw_initial_draft_slots(p_league_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rebuilding the board now re-draws the order in the same transaction.
--    Unchanged from 20260711000007 apart from the trailing PERFORM.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_draft_picks(
  p_league_id uuid,
  p_draft_id uuid DEFAULT NULL,         -- NULL = leave the initial draft alone
  p_picks_per_round integer DEFAULT NULL,
  p_initial_picks jsonb DEFAULT NULL,
  p_future_picks jsonb DEFAULT NULL     -- NULL = leave future picks alone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can regenerate draft picks'
      USING ERRCODE = '42501';
  END IF;

  IF p_draft_id IS NOT NULL AND p_initial_picks IS NOT NULL THEN
    UPDATE drafts SET picks_per_round = p_picks_per_round WHERE id = p_draft_id;

    DELETE FROM draft_picks WHERE draft_id = p_draft_id;

    INSERT INTO draft_picks (league_id, draft_id, season, round, pick_number, slot_number)
    SELECT p_league_id, p_draft_id, p->>'season',
           (p->>'round')::integer, (p->>'pick_number')::integer, (p->>'slot_number')::integer
      FROM jsonb_array_elements(p_initial_picks) AS p;
  END IF;

  IF p_future_picks IS NOT NULL THEN
    DELETE FROM draft_picks WHERE league_id = p_league_id AND draft_id IS NULL;

    INSERT INTO draft_picks (league_id, season, round, slot_number)
    SELECT p_league_id, p->>'season', (p->>'round')::integer, (p->>'slot_number')::integer
      FROM jsonb_array_elements(p_future_picks) AS p;
  END IF;

  -- The rows above are inserted unowned, so without this the resize leaves the
  -- league with a board nobody picks from. No-ops when the order is manual (the
  -- commissioner re-sets it) or the league isn't full yet (the next joiner's
  -- assign_initial_draft_slots draws it).
  PERFORM draw_initial_draft_slots(p_league_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_draft_picks(uuid, uuid, integer, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_draft_picks(uuid, uuid, integer, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.replace_draft_picks(uuid, uuid, integer, jsonb, jsonb) FROM anon;
