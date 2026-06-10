-- Commissioner "remove a member" + the missing decrement_team_count RPC.
--
-- 1. vacate_team_internal — the cleanup half of leave_league, extracted so the
--    self-serve "leave" and the commissioner-initiated "remove" paths can't drift.
-- 2. leave_league — re-pointed at the shared helper (behaviour unchanged).
-- 3. remove_member — commissioner vacates ANOTHER member's team (kept + claimable).
-- 4. decrement_team_count — delete-account already calls this RPC, but it was
--    never created, so the call silently errored. Mirrors increment_team_count.

-- ---------------------------------------------------------------------------
-- 1. Shared vacate helper. NOT client-callable (revoked from public); only the
--    SECURITY DEFINER callers below invoke it. Cancels the team's open trades +
--    pending waiver/transaction activity, drops the owner's notification prefs,
--    then releases ownership. The roster (league_players) and the team row are
--    intentionally KEPT so the slot stays filled for the next owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vacate_team_internal(p_league_id uuid, p_team_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE trade_proposals
  SET status = 'cancelled'
  WHERE status IN ('pending', 'accepted', 'in_review')
    AND id IN (SELECT proposal_id FROM trade_proposal_teams WHERE team_id = p_team_id);

  DELETE FROM waiver_claims WHERE team_id = p_team_id;
  DELETE FROM waiver_priority WHERE team_id = p_team_id;
  DELETE FROM pending_transactions WHERE team_id = p_team_id;

  IF p_user_id IS NOT NULL THEN
    DELETE FROM league_notification_prefs WHERE league_id = p_league_id AND user_id = p_user_id;
  END IF;

  UPDATE teams SET user_id = NULL, is_commissioner = false WHERE id = p_team_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. leave_league — now delegates the vacate to the shared helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_league(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_created_by uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_team_id
  FROM teams
  WHERE league_id = p_league_id AND user_id = v_user_id;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_a_member');
  END IF;

  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;
  IF v_created_by = v_user_id THEN
    RETURN jsonb_build_object('error', 'commissioner_must_reassign');
  END IF;

  IF EXISTS (SELECT 1 FROM drafts WHERE league_id = p_league_id AND status = 'in_progress') THEN
    RETURN jsonb_build_object('error', 'draft_in_progress');
  END IF;

  -- current_teams is deliberately NOT decremented — the vacated team still
  -- occupies its slot; the commissioner reassigns it via transfer_team_ownership.
  PERFORM vacate_team_internal(p_league_id, v_team_id, v_user_id);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. remove_member — commissioner vacates another member's team (kicks them).
--    The team + roster stay (claimable via transfer_team_ownership); the booted
--    user loses access on their next launch (RLS + the AppStateProvider fallback).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_member(p_league_id uuid, p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_created_by uuid;
  v_target_user uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;
  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('error', 'league_not_found');
  END IF;
  IF v_created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can remove a member';
  END IF;

  SELECT user_id INTO v_target_user FROM teams WHERE id = p_team_id AND league_id = p_league_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'team_not_found');
  END IF;
  IF v_target_user IS NULL THEN
    RETURN jsonb_build_object('error', 'already_unclaimed');
  END IF;
  IF v_target_user = v_user_id THEN
    -- The commissioner can't remove themselves here — they leave/reassign/archive.
    RETURN jsonb_build_object('error', 'cannot_remove_self');
  END IF;

  IF EXISTS (SELECT 1 FROM drafts WHERE league_id = p_league_id AND status = 'in_progress') THEN
    RETURN jsonb_build_object('error', 'draft_in_progress');
  END IF;

  PERFORM vacate_team_internal(p_league_id, p_team_id, v_target_user);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. decrement_team_count — the long-missing sibling of increment_team_count.
--    delete-account calls it after deleting a user's teams. Floors at 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_team_count(lid uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_count integer;
BEGIN
  UPDATE leagues
  SET current_teams = GREATEST(COALESCE(current_teams, 0) - 1, 0)
  WHERE id = lid
  RETURNING current_teams INTO new_count;

  RETURN new_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants. Supabase's default privileges grant EXECUTE to anon + authenticated
--    on new public functions, and REVOKE FROM public does NOT strip those — so we
--    revoke anon explicitly (project SD-function lockdown convention). The internal
--    helper additionally revokes authenticated so only the definer callers (running
--    as owner) and service_role can reach it — it has no auth check of its own.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.vacate_team_internal(uuid, uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.decrement_team_count(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_team_count(uuid) TO authenticated;
