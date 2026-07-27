-- join_league_team: add the server-side guards the client was solely responsible for.
--
-- Why: joining a league happens through several avenues (invite code, public
-- league list, the home invite card, a league-invite push tap) and ONLY the
-- invite-code screen ran the already-a-member / capacity preflight. Every other
-- avenue could call this RPC on a league that was already full, and nothing
-- server-side said no — `increment_team_count` just increments, so
-- `leagues.current_teams` would sail past `leagues.teams` permanently.
--
-- The duplicate-team case was already blocked, but only by the
-- `idx_teams_user_id_league_id` unique index, which surfaces as a raw 23505 the
-- client turned into "Failed to create team." These raise named, client-safe
-- messages instead so the UI can say what actually happened.
--
-- Note this correctly blocks create-team on IMPORTED leagues: they pre-create
-- every team at import, so current_teams = teams on day one and the join path
-- for them is claim_imported_team, not this function.

CREATE OR REPLACE FUNCTION public.join_league_team(p_league_id uuid, p_name text, p_tricode text, p_is_commissioner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_id       uuid;
  v_current       integer;
  v_max           integer;
  v_faab          integer;
  v_divisions     integer;
  v_manual_order  boolean;
  v_archived      timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized: sign in to join a league' USING ERRCODE = '42501';
  END IF;

  -- Lock the league row so two concurrent joiners can't both read the same
  -- pre-increment count and each pass the capacity check below.
  SELECT current_teams, teams, archived_at
    INTO v_current, v_max, v_archived
    FROM leagues WHERE id = p_league_id FOR UPDATE;

  IF v_max IS NULL THEN
    RAISE EXCEPTION 'not_found: that league no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'league_archived: that league has been deleted' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM teams
     WHERE teams.league_id = p_league_id AND teams.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'already_member: you already have a team in this league'
      USING ERRCODE = '23505';
  END IF;

  IF COALESCE(v_current, 0) >= v_max THEN
    RAISE EXCEPTION 'league_full: this league is already full'
      USING ERRCODE = 'check_violation';
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
$function$;
