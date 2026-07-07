-- Security review 2026-07-07 — HIGH: draft_picks pick theft.
--
-- draft_picks_update was USING/CHECK is_league_member(league_id), so any league
-- member could UPDATE any pick's current_team_id and reassign every future draft
-- pick in the league to their own team. Tighten the policy to commissioner /
-- own-pick / claim-an-unassigned-pick-for-yourself, and move the one legit
-- member-run write that touches OTHER teams' picks — the fill-time slot shuffle
-- (checkAndAssignDraftSlots) — into a SECURITY DEFINER RPC.

-- 1. Server-side slot assignment (replaces client checkAndAssignDraftSlots).
--    Any member can trigger it, but it only performs the deterministic slot
--    assignment when the league is full, order is not manual, and the draft
--    hasn't begun — it cannot be used to steal a specific pick.
CREATE OR REPLACE FUNCTION public.assign_initial_draft_slots(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order text;
  v_league_size int;
  v_team_count int;
  v_draft_id uuid;
  v_team_ids uuid[];
BEGIN
  IF NOT is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  SELECT initial_draft_order, teams INTO v_order, v_league_size
  FROM leagues WHERE id = p_league_id;

  IF v_order = 'manual' THEN RETURN; END IF;              -- commissioner sets order manually

  SELECT count(*) INTO v_team_count FROM teams WHERE league_id = p_league_id;
  IF v_team_count < v_league_size THEN RETURN; END IF;    -- not full yet

  SELECT id INTO v_draft_id
  FROM drafts WHERE league_id = p_league_id AND type = 'initial' LIMIT 1;
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

REVOKE EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) TO authenticated;

-- 2. Lock down the direct UPDATE policy.
--    USING allows: commissioner (pick conditions / manual order), a member's own
--    pick, or claiming a currently-unassigned pick. CHECK forbids assigning a
--    pick to anyone but yourself (unless commissioner) — so no pick theft.
DROP POLICY IF EXISTS draft_picks_update ON public.draft_picks;
CREATE POLICY draft_picks_update ON public.draft_picks
  FOR UPDATE TO authenticated
  USING (
    is_league_commissioner(league_id)
    OR current_team_id IS NULL
    OR current_team_id = my_team_id(league_id)
  )
  WITH CHECK (
    is_league_commissioner(league_id)
    OR current_team_id = my_team_id(league_id)
  );
