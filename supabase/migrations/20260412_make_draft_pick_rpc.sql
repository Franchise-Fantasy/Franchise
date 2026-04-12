-- Wraps the core draft-pick mutations in a single transaction.
-- The edge function still handles auth, validation, position checks, and slot-finding,
-- then calls this RPC for the atomic state change.

CREATE OR REPLACE FUNCTION public.execute_draft_pick(
  p_draft_id uuid,
  p_pick_number integer,
  p_player_id uuid,
  p_league_id uuid,
  p_team_id uuid,
  p_roster_slot text,
  p_player_position text,
  p_is_rookie_draft boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_picks integer;
  v_next_pick integer;
  v_is_complete boolean;
  v_timestamp timestamptz := now();
BEGIN
  -- 1. Record the pick
  UPDATE public.draft_picks
  SET player_id = p_player_id, selected_at = v_timestamp
  WHERE draft_id = p_draft_id AND pick_number = p_pick_number;

  -- 2. Add player to roster
  INSERT INTO public.league_players (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
  VALUES (
    p_league_id, p_player_id, p_team_id,
    CASE WHEN p_is_rookie_draft THEN 'rookie_draft' ELSE 'draft' END,
    v_timestamp, p_player_position, p_roster_slot
  );

  -- 3. Remove from all draft queues
  DELETE FROM public.draft_queue
  WHERE draft_id = p_draft_id AND player_id = p_player_id;

  -- 4. Advance draft
  v_next_pick := p_pick_number + 1;
  SELECT (rounds * picks_per_round) INTO v_total_picks
  FROM public.drafts WHERE id = p_draft_id;

  v_is_complete := v_next_pick > v_total_picks;

  UPDATE public.drafts
  SET current_pick_number = v_next_pick,
      current_pick_timestamp = v_timestamp,
      status = CASE WHEN v_is_complete THEN 'complete' ELSE status END
  WHERE id = p_draft_id;

  -- 5. If rookie draft complete, advance offseason
  IF v_is_complete AND p_is_rookie_draft THEN
    UPDATE public.leagues
    SET offseason_step = 'rookie_draft_complete'
    WHERE id = p_league_id;
  END IF;

  RETURN jsonb_build_object(
    'is_complete', v_is_complete,
    'next_pick_number', v_next_pick
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) FROM anon, authenticated;
