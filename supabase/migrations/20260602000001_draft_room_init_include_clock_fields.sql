-- get_draft_room_init built its draft JSON by listing columns explicitly, so
-- it never surfaced current_pick_time_limit or the new round-acceleration
-- fields. The realtime select('*') backfilled them after the first UPDATE, but
-- on first open the commissioner controls sheet (and the countdown) saw a draft
-- without its acceleration config. Add the three clock fields so the seeded
-- draft state is correct immediately.

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
      'season', v_draft.season
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
