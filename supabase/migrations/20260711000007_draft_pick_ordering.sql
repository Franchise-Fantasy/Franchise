-- Atomic draft-pick ordering and regeneration.
--
-- Three separate partial-write bugs in lib/draft.ts, all the same shape: a
-- PERMUTATION applied as N independent UPDATEs via Promise.all. A draft order is
-- only meaningful as a whole — half of one is not "most of a draft order", it's
-- a corrupt one, with two teams owning slot 3 and nobody owning slot 7.
--
--   * manuallyAssignDraftSlots — N updates to the initial draft's picks, then N
--     more to the future-season picks. A failure anywhere leaves the two sets
--     disagreeing about who picks where.
--   * reorderRookieDraftPicks — chunked Promise.all over every pick in the
--     season; a failed chunk leaves earlier rounds re-ordered and later rounds
--     on the old order.
--   * EditBasicsModal's league-resize — DELETEs every draft pick and regenerates
--     them; a failure between the two leaves the league with NO draft picks. Its
--     catch block says "picks may need manual regeneration", which is an
--     admission that this was known to be non-atomic.
--
-- Expressing each as a single UPDATE ... FROM unnest(...) WITH ORDINALITY makes
-- the permutation atomic by construction — and collapses N round-trips to one.

-- Commissioner sets the draft order by hand. Applies the same order to the
-- initial draft AND to the future-season picks (which have no draft_id yet).
CREATE OR REPLACE FUNCTION public.assign_draft_slots_manual(
  p_league_id uuid,
  p_draft_id uuid,
  p_team_ids uuid[]                     -- ordered: index 1 = slot 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can set the draft order'
      USING ERRCODE = '42501';
  END IF;

  UPDATE draft_picks dp
     SET current_team_id = o.team_id, original_team_id = o.team_id
    FROM unnest(p_team_ids) WITH ORDINALITY AS o(team_id, ord)
   WHERE dp.draft_id = p_draft_id
     AND dp.slot_number = o.ord;

  UPDATE draft_picks dp
     SET current_team_id = o.team_id, original_team_id = o.team_id
    FROM unnest(p_team_ids) WITH ORDINALITY AS o(team_id, ord)
   WHERE dp.league_id = p_league_id
     AND dp.draft_id IS NULL
     AND dp.slot_number = o.ord;
END;
$$;

-- Re-order an imported dynasty league's upcoming rookie draft (picks not yet
-- linked to a draft). Order is defined by original_team_id → slot, so a traded
-- pick keeps its current owner and simply travels to its originating team's new
-- slot. Pick numbering is linear across rounds, matching the import seed.
CREATE OR REPLACE FUNCTION public.reorder_rookie_draft_picks(
  p_league_id uuid,
  p_season text,
  p_team_ids uuid[]                     -- ordered original_team_ids
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := array_length(p_team_ids, 1);
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can re-order the rookie draft'
      USING ERRCODE = '42501';
  END IF;

  IF v_n IS NULL OR v_n = 0 THEN RETURN; END IF;

  UPDATE draft_picks dp
     SET slot_number = o.ord,
         pick_number = (dp.round - 1) * v_n + o.ord
    FROM unnest(p_team_ids) WITH ORDINALITY AS o(team_id, ord)
   WHERE dp.league_id = p_league_id
     AND dp.season    = p_season
     AND dp.draft_id IS NULL
     AND dp.player_id IS NULL
     AND dp.original_team_id = o.team_id;
END;
$$;

-- Wipe-and-regenerate the league's draft picks after a size change. The pick
-- rows (snake reversal, pick numbering, per-sport season formatting) are built
-- in TS and passed in; this only applies the swap, together.
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_draft_slots_manual(uuid, uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_draft_slots_manual(uuid, uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.assign_draft_slots_manual(uuid, uuid, uuid[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.reorder_rookie_draft_picks(uuid, text, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reorder_rookie_draft_picks(uuid, text, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.reorder_rookie_draft_picks(uuid, text, uuid[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.replace_draft_picks(uuid, uuid, integer, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_draft_picks(uuid, uuid, integer, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.replace_draft_picks(uuid, uuid, integer, jsonb, jsonb) FROM anon;
