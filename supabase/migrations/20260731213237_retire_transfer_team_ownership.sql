-- Retire transfer_team_ownership in favour of the invite flow.
--
-- transfer_team_ownership stamped `teams.user_id` straight from an RPC: the new
-- owner was never asked and never told, and the UPDATE had no `user_id IS NULL`
-- guard, so pointing it at a team someone already owned silently evicted them
-- (bypassing the vacate_team_internal path that leave_league / remove_member
-- share). Its commissioner check was also `leagues.created_by` only, so a
-- commissioner installed by reassign_commissioner couldn't call it at all, and
-- it never checked `archived_at`.
--
-- The replacement is send-league-invite with a `team_id`: it reserves an
-- unclaimed team, persists an `invitations` row, pushes the invitee, and they
-- take the team over by accepting (claim_imported_team). To reassign a team
-- that still HAS an owner, remove the member first — that vacates the team —
-- then invite into it.
DROP FUNCTION IF EXISTS public.transfer_team_ownership(uuid, uuid, text);

-- claim_imported_team predates open leagues having vacatable teams, so it
-- rejected anything with `sleeper_roster_id IS NULL` as "not an imported team".
-- That made a team vacated by leave_league / remove_member permanently
-- unclaimable — which is exactly the handover case transfer_team_ownership was
-- covering, so the guard has to go for that path to work at all. Ownership is
-- still gated on `user_id IS NULL`; the name is kept so older clients keep
-- resolving the RPC.
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

-- One pending reservation per team. `invitations_pending_unique` only covers
-- (league_id, invited_user_id), so nothing stopped two DIFFERENT people from
-- being invited to the same team — both get a card, both tap claim, and the
-- loser hits "Team is already claimed" with no explanation. Now that reserving
-- a team is the whole replacement for transfer_team_ownership, that has to be
-- impossible rather than merely unlikely.
--
-- Open-league invites (team_id IS NULL) are excluded: many can be outstanding
-- at once. send-league-invite pre-checks this and returns a 409 naming the
-- holder; the index is the race backstop for two commissioners sending at once.

-- Collapse any double reservations that already exist, newest wins, so the
-- index can be built. (created_at, id) breaks same-millisecond ties.
UPDATE invitations i
SET status = 'cancelled'
WHERE i.status = 'pending'
  AND i.team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM invitations j
    WHERE j.league_id = i.league_id
      AND j.team_id = i.team_id
      AND j.status = 'pending'
      AND (j.created_at, j.id) > (i.created_at, i.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_team_unique
  ON public.invitations (league_id, team_id)
  WHERE status = 'pending' AND team_id IS NOT NULL;
