-- A reserved team is HELD — claiming is gated on the reservation, not just on
-- `user_id IS NULL`.
--
-- `send-league-invite` treats a team_id invite as an exclusive hold: it 409s a
-- second commissioner trying to reserve the same team ("Cancel that invite
-- first"), and `invitations_pending_team_unique` backstops the race. But the
-- CLAIM side never looked at `invitations` at all, so the hold was advisory
-- only — any invitee (or anyone with the league's invite code) could open
-- /claim-team and take a roster the commissioner had reserved for somebody
-- else. That person then lands on the generic "Team is already claimed" with no
-- way back to the team meant for them.
--
-- The invitee's own reservation is NOT enforced as a lock: the claim screen
-- deliberately lists the other open teams as a fallback for when their reserved
-- team was taken first, and the client confirms before deviating. Only teams
-- held for a DIFFERENT user are blocked here.
--
-- The error message deliberately omits who holds it — the claimer isn't the
-- commissioner and `invitations_select` would never show them that row.
CREATE OR REPLACE FUNCTION public.claim_imported_team(team_id_input uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_league_id uuid;
  v_team_user_id uuid;
  v_archived_at timestamptz;
  v_existing uuid;
  v_reserved_for uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT t.league_id, t.user_id
  INTO v_league_id, v_team_user_id
  FROM teams t
  WHERE t.id = team_id_input;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  IF v_team_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Team is already claimed';
  END IF;

  -- SECURITY DEFINER bypasses the leagues_select RLS policy that hides archived
  -- leagues, so the archived check has to be explicit here.
  SELECT l.archived_at INTO v_archived_at FROM leagues l WHERE l.id = v_league_id;
  IF v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'League not found';
  END IF;

  SELECT id INTO v_existing
  FROM teams
  WHERE league_id = v_league_id AND user_id = v_user_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a team in this league';
  END IF;

  SELECT i.invited_user_id INTO v_reserved_for
  FROM invitations i
  WHERE i.league_id = v_league_id
    AND i.team_id = team_id_input
    AND i.status = 'pending'
    AND i.invited_user_id <> v_user_id
  LIMIT 1;

  IF v_reserved_for IS NOT NULL THEN
    RAISE EXCEPTION 'That team is reserved for another manager. Pick a different team.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE teams
  SET user_id = v_user_id
  WHERE id = team_id_input
    AND user_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team is already claimed';
  END IF;

  RETURN team_id_input;
END;
$$;

-- CREATE OR REPLACE resets nothing, but re-assert the grants so this file is
-- self-contained if it is ever replayed onto a fresh database.
REVOKE EXECUTE ON FUNCTION public.claim_imported_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_imported_team(uuid) TO authenticated;

-- The lookup above filters on (league_id, team_id, status) — the existing
-- partial unique index is on (league_id, team_id) WHERE status = 'pending',
-- which serves it exactly. No new index needed.
