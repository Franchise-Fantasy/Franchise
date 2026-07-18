-- Security 2026-07-14 — draft_picks: close the column-write hole.
--
-- The 20260707154022 lockdown fixed pick THEFT (you can't move a pick to another
-- team) but the UPDATE grant is column-blind, so the row policy was the only
-- gate. Its `current_team_id = my_team_id(league_id)` branch let any member
-- rewrite EVERY column on a pick they own:
--
--   * `round` 2 → 1: the trade UI labels picks off `round`, so a member could
--     market a 2nd-rounder as a 1st. Trade fraud.
--   * `pick_number` → the draft's current pick: make-draft-pick resolves the
--     on-the-clock pick with `.eq('pick_number', …).single()`, so a duplicate
--     makes that query error and NOBODY can pick. Draft-wide DoS.
--   * protection_threshold / protection_owner_id / notes: self-authored.
--
-- Fix: no client role gets a direct UPDATE on draft_picks at all. Every write is
-- now either a SECURITY DEFINER RPC (owner = postgres, so unaffected by these
-- grants) or a service-role edge function. The two commissioner writes that were
-- still going direct from ManagePickConditionsModal move into RPCs here.
--
-- NOTE (the SD-bypasses-RLS trap): SECURITY DEFINER skips RLS, so each function
-- below must RE-ASSERT the commissioner check the policy used to perform.

-- 1. "Fix a Pick" — reassign a pick's owner and/or correct its round.
CREATE OR REPLACE FUNCTION public.commissioner_fix_draft_pick(
  p_pick_id uuid,
  p_current_team_id uuid,
  p_round int,
  p_notes text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league_id uuid;
  v_old_round int;
  v_draft_id uuid;
  v_max_round int;
BEGIN
  SELECT league_id, round, draft_id
    INTO v_league_id, v_old_round, v_draft_id
  FROM draft_picks WHERE id = p_pick_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Draft pick not found';
  END IF;

  IF NOT is_league_commissioner(v_league_id) THEN
    RAISE EXCEPTION 'Only the commissioner can fix a draft pick';
  END IF;

  -- The new owner must be a team in THIS league (a bare uuid could otherwise
  -- hand the pick to a team in someone else's league).
  IF NOT EXISTS (
    SELECT 1 FROM teams WHERE id = p_current_team_id AND league_id = v_league_id
  ) THEN
    RAISE EXCEPTION 'That team is not in this league';
  END IF;

  -- Round has to exist in the draft this pick belongs to.
  IF v_draft_id IS NOT NULL THEN
    SELECT rounds INTO v_max_round FROM drafts WHERE id = v_draft_id;
  ELSE
    SELECT rookie_draft_rounds INTO v_max_round FROM leagues WHERE id = v_league_id;
  END IF;
  v_max_round := coalesce(v_max_round, 2);

  IF p_round < 1 OR p_round > v_max_round THEN
    RAISE EXCEPTION 'Round % is out of range for this draft (1-%)', p_round, v_max_round;
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 500 THEN
    RAISE EXCEPTION 'Note must be 500 characters or less';
  END IF;

  UPDATE draft_picks
  SET current_team_id = p_current_team_id,
      round           = p_round,
      notes           = p_notes,
      -- pick_number / slot_number describe a position WITHIN a round, so they
      -- stop describing this pick the moment its round moves — a round-1
      -- pick_number of 8 would render as "2026 2nd · Pick 8". Clear them so the
      -- label honestly reads "order not set" until a draft/lottery assigns one.
      pick_number = CASE WHEN p_round <> v_old_round THEN NULL ELSE pick_number END,
      slot_number = CASE WHEN p_round <> v_old_round THEN NULL ELSE slot_number END
  WHERE id = p_pick_id;
END;
$function$;

-- 2. Pick protection — set (threshold + owner) or clear (threshold NULL).
CREATE OR REPLACE FUNCTION public.commissioner_set_pick_protection(
  p_pick_id uuid,
  p_threshold int DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league_id uuid;
  v_teams int;
BEGIN
  SELECT league_id INTO v_league_id FROM draft_picks WHERE id = p_pick_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Draft pick not found';
  END IF;

  IF NOT is_league_commissioner(v_league_id) THEN
    RAISE EXCEPTION 'Only the commissioner can change pick protection';
  END IF;

  -- NULL threshold = remove the protection entirely.
  IF p_threshold IS NULL THEN
    UPDATE draft_picks
    SET protection_threshold = NULL, protection_owner_id = NULL
    WHERE id = p_pick_id;
    RETURN;
  END IF;

  SELECT teams INTO v_teams FROM leagues WHERE id = v_league_id;
  v_teams := coalesce(v_teams, 10);

  IF p_threshold < 1 OR p_threshold > v_teams - 1 THEN
    RAISE EXCEPTION 'Protection threshold must be between 1 and %', v_teams - 1;
  END IF;

  IF p_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM teams WHERE id = p_owner_id AND league_id = v_league_id
  ) THEN
    RAISE EXCEPTION 'The protected owner must be a team in this league';
  END IF;

  UPDATE draft_picks
  SET protection_threshold = p_threshold, protection_owner_id = p_owner_id
  WHERE id = p_pick_id;
END;
$function$;

-- Supabase grants EXECUTE on every new public function to anon + authenticated
-- AND to the PUBLIC pseudo-role. Revoking from `anon` alone leaves it EXECUTE via
-- PUBLIC (verified: has_function_privilege('anon', …) stayed true), so both have
-- to come off. Keep authenticated — a signed-in commissioner is the caller.
REVOKE EXECUTE ON FUNCTION public.commissioner_fix_draft_pick(uuid, uuid, int, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.commissioner_fix_draft_pick(uuid, uuid, int, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.commissioner_set_pick_protection(uuid, int, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.commissioner_set_pick_protection(uuid, int, uuid) TO authenticated;

-- 3. Drop the direct-UPDATE surface. Nothing client-side needs it any more.
REVOKE UPDATE ON public.draft_picks FROM authenticated, anon;

-- 4. Keep a commissioner-only policy as defense in depth, so that if a broad
--    GRANT is ever re-applied (e.g. GRANT ALL), the member-write hole doesn't
--    silently come back with it. The old member branches are gone.
DROP POLICY IF EXISTS draft_picks_update ON public.draft_picks;
CREATE POLICY draft_picks_update ON public.draft_picks
  FOR UPDATE TO authenticated
  USING (is_league_commissioner(league_id))
  WITH CHECK (is_league_commissioner(league_id));
