-- get_draft_room_init lists the draft's columns explicitly and had never
-- included `draft_type`, so the room's first paint saw it as undefined.
--
-- Both consumers treat "not linear" as snake (`formatDraftType`, and the
-- lobby's "Reverses Each Round" note), so a LINEAR draft rendered as Snake in
-- the pre-draft lobby until the `drafts select *` refetch landed a moment
-- later. Cosmetic, but it's a wrong statement about the format on the one
-- screen whose whole job is telling managers what they're walking into — and
-- there are live linear drafts.
--
-- Mirrors the current definition (20260725000002) + one appended field.

CREATE OR REPLACE FUNCTION public.get_draft_room_init(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_draft record;
  v_team record;
  v_is_commissioner boolean;
  v_draft_pick_trading boolean;
  v_autopick boolean;
BEGIN
  -- Fetch the full draft state
  SELECT * INTO v_draft FROM drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  -- Fetch user's team in this league
  SELECT id, name, tricode, logo_key
    INTO v_team
    FROM teams
   WHERE league_id = v_draft.league_id
     AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  -- Commissioner check
  SELECT (created_by = v_uid) INTO v_is_commissioner
    FROM leagues WHERE id = v_draft.league_id;

  -- Draft pick trading setting
  SELECT draft_pick_trading_enabled INTO v_draft_pick_trading
    FROM leagues WHERE id = v_draft.league_id;

  -- Autopick status
  SELECT COALESCE(autopick_on, false) INTO v_autopick
    FROM draft_team_status
   WHERE draft_id = p_draft_id
     AND team_id = v_team.id;

  IF NOT FOUND THEN
    v_autopick := false;
  END IF;

  RETURN jsonb_build_object(
    'draft', jsonb_build_object(
      'id', v_draft.id,
      'league_id', v_draft.league_id,
      'type', v_draft.type,
      'draft_type', v_draft.draft_type,
      'status', v_draft.status,
      'draft_date', v_draft.draft_date,
      'time_limit', v_draft.time_limit,
      'current_pick_time_limit', v_draft.current_pick_time_limit,
      'accelerate_after_round', v_draft.accelerate_after_round,
      'accelerated_time_limit', v_draft.accelerated_time_limit,
      'current_pick_number', v_draft.current_pick_number,
      'current_pick_timestamp', v_draft.current_pick_timestamp,
      'picks_per_round', v_draft.picks_per_round,
      'rounds', v_draft.rounds,
      'season', v_draft.season,
      'paused_at', v_draft.paused_at,
      'paused_remaining_ms', v_draft.paused_remaining_ms,
      'pause_reason', v_draft.pause_reason,
      'quiet_hours_enabled', v_draft.quiet_hours_enabled,
      'quiet_hours_start_min', v_draft.quiet_hours_start_min,
      'quiet_hours_end_min', v_draft.quiet_hours_end_min
    ),
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'tricode', v_team.tricode,
      'logo_key', v_team.logo_key,
      'is_commissioner', v_is_commissioner
    ),
    'draft_pick_trading_enabled', v_draft_pick_trading,
    'autopick_on', v_autopick
  );
END;
$function$;

-- CREATE OR REPLACE preserves the existing ACL, but Supabase's default-privilege
-- event trigger fires on the DDL — re-assert the lockdown so a replace can't
-- quietly hand EXECUTE back to anon. PUBLIC is revoked too: role-specific
-- revokes do NOT strip an implicit PUBLIC grant, and PUBLIC covers anon.
REVOKE EXECUTE ON FUNCTION public.get_draft_room_init(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_draft_room_init(uuid) TO authenticated;
