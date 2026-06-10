-- Leave League + Archive League (soft-delete)
--
-- Adds three member/commissioner lifecycle RPCs and a soft-delete flag on leagues.
--
-- Why soft-delete (archive) instead of a hard DELETE: ~30 child tables reference
-- leagues/teams, 8 of them with ON DELETE NO ACTION (league_waivers,
-- pending_transactions, subscription_events, trade_proposals, trade_rumors,
-- waiver_claims, waiver_priority, orphan chat_messages) plus a leagues.champion_team_id
-- self-reference, so a real delete needs a hand-maintained ordered teardown and is
-- irreversible. An archived_at flag is atomic, reversible (support restores via a
-- single UPDATE), and avoids the cascade entirely.
--
-- Leaving "freezes" a team: user_id is cleared but the roster stays intact so the
-- commissioner can hand the slot to a new owner via transfer_team_ownership.

-- ---------------------------------------------------------------------------
-- 1. Soft-delete columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Keeps the "active leagues" scans that crons run cheap.
CREATE INDEX IF NOT EXISTS leagues_active_idx ON public.leagues (id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Hide archived leagues from every client read (defense in depth).
--    leagues_select was `USING (true)` (open preview for invite links); archived
--    leagues now disappear from all client SELECTs and joins in one place, and the
--    join-by-invite lookup rejects them for free. Service-role crons bypass RLS and
--    are filtered explicitly in their own queries.
-- ---------------------------------------------------------------------------
ALTER POLICY leagues_select ON public.leagues USING (archived_at IS NULL);

-- ---------------------------------------------------------------------------
-- 3. leave_league: vacate the caller's own team (roster kept), reopen the slot.
--    Commissioner must hand off first; blocked during a live draft.
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

  -- The caller's own team in this league (ownership is enforced here: a member can
  -- only ever vacate their own team, never someone else's).
  SELECT id INTO v_team_id
  FROM teams
  WHERE league_id = p_league_id AND user_id = v_user_id;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_a_member');
  END IF;

  -- The commissioner cannot abandon the league's authority; they must reassign first
  -- (or archive the league if they are the only member).
  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;
  IF v_created_by = v_user_id THEN
    RETURN jsonb_build_object('error', 'commissioner_must_reassign');
  END IF;

  -- Leaving mid-draft would corrupt the pick order.
  IF EXISTS (SELECT 1 FROM drafts WHERE league_id = p_league_id AND status = 'in_progress') THEN
    RETURN jsonb_build_object('error', 'draft_in_progress');
  END IF;

  -- Cancel any open trade involving this team (as proposer or counterparty).
  UPDATE trade_proposals
  SET status = 'cancelled'
  WHERE status IN ('pending', 'accepted', 'in_review')
    AND id IN (SELECT proposal_id FROM trade_proposal_teams WHERE team_id = v_team_id);

  -- Clear the team's pending waiver / transaction activity.
  DELETE FROM waiver_claims WHERE team_id = v_team_id;
  DELETE FROM waiver_priority WHERE team_id = v_team_id;
  DELETE FROM pending_transactions WHERE team_id = v_team_id;

  -- Stop notifying the departing user about this league.
  DELETE FROM league_notification_prefs WHERE league_id = p_league_id AND user_id = v_user_id;

  -- Vacate the team: keep the roster (league_players) so the next owner inherits
  -- it, but release ownership and the local commissioner flag. current_teams is
  -- deliberately NOT decremented — the team row still occupies its slot, so the
  -- league stays "full" and join-by-code can't create an extra team. The
  -- commissioner hands the now-unowned team to a new owner via
  -- transfer_team_ownership (which already targets "Unclaimed" user_id IS NULL teams).
  UPDATE teams SET user_id = NULL, is_commissioner = false WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. reassign_commissioner: hand the gavel to another existing member.
--    Keeps the three sources of truth in sync: leagues.created_by,
--    leagues.commissioner, teams.is_commissioner. Usable standalone (no leaving).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_commissioner(p_league_id uuid, p_new_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_created_by uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;

  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('error', 'league_not_found');
  END IF;
  IF v_created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can reassign the commissioner role';
  END IF;
  IF p_new_user_id = v_user_id THEN
    RETURN jsonb_build_object('error', 'already_commissioner');
  END IF;

  -- The new commissioner must already own a team in this league.
  IF NOT EXISTS (
    SELECT 1 FROM teams WHERE league_id = p_league_id AND user_id = p_new_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'target_not_member');
  END IF;

  UPDATE leagues
  SET created_by = p_new_user_id, commissioner = p_new_user_id
  WHERE id = p_league_id;

  -- IS NOT DISTINCT FROM is null-safe: unowned teams (user_id NULL) get false, not NULL.
  UPDATE teams
  SET is_commissioner = (user_id IS NOT DISTINCT FROM p_new_user_id)
  WHERE league_id = p_league_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. archive_league: soft-delete. Idempotent. Clears any favorite pointers so home
--    does not resolve to a now-hidden league. Restore (support only):
--      UPDATE leagues SET archived_at = NULL, archived_by = NULL WHERE id = '<uuid>';
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_league(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_created_by uuid;
  v_archived_at timestamptz;
BEGIN
  SELECT created_by, archived_at INTO v_created_by, v_archived_at
  FROM leagues WHERE id = p_league_id;

  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('error', 'league_not_found');
  END IF;
  IF v_created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can archive this league';
  END IF;

  IF v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true); -- already archived
  END IF;

  UPDATE leagues SET archived_at = now(), archived_by = v_user_id WHERE id = p_league_id;
  UPDATE profiles SET favorite_league_id = NULL WHERE favorite_league_id = p_league_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants: authenticated callers only (each function self-checks auth.uid()).
--    Supabase's default privileges grant EXECUTE to anon + authenticated on new
--    public functions, and REVOKE FROM public does NOT strip those — so anon must
--    be revoked explicitly (matches the project's SD-function lockdown convention).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.leave_league(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.reassign_commissioner(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.archive_league(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leave_league(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_commissioner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_league(uuid) TO authenticated;
