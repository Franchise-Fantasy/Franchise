-- Atomic keeper finalization. finalize-keepers previously ran three separate
-- PostgREST writes: (1) delete non-kept league_players, (2) delete this
-- season's keeper_declarations, (3) advance leagues.offseason_step. The
-- offseason_step gate flips only in write (3), but the "who to keep" source
-- (keeper_declarations) is destroyed in write (2). So if (3) failed after (2)
-- committed, the gate stayed 'keeper_pending' and a commissioner retry read
-- ZERO declarations, took the no-keepers branch, and released EVERY roster in
-- the league — an unrecoverable wipe.
--
-- This function performs the release + declarations cleanup + step advance in
-- one transaction (plpgsql is atomic), so a failure rolls back all three and a
-- retry re-reads the still-present declarations. FOR UPDATE on the league row
-- serializes concurrent finalize / advance-season calls.
--
-- Auth is enforced by the calling edge function (commissioner check); this
-- helper is service_role / definer only, matching execute_draft_pick and
-- create_playoff_round_atomic.
--
-- Returns: { kept_count, released_count }

CREATE OR REPLACE FUNCTION public.finalize_keepers_atomic(
  p_league_id uuid,
  p_season text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offseason_step text;
  v_league_type text;
  v_kept_count integer;
  v_released_count integer;
BEGIN
  -- Lock the league and re-check state inside the txn (race-safe backstop; the
  -- edge function does the friendly-error version of these checks up front).
  SELECT offseason_step, league_type
    INTO v_offseason_step, v_league_type
  FROM leagues
  WHERE id = p_league_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'league % not found', p_league_id;
  END IF;

  IF v_league_type <> 'keeper' THEN
    RAISE EXCEPTION 'league % is not a keeper league', p_league_id;
  END IF;

  IF v_offseason_step IS DISTINCT FROM 'keeper_pending' THEN
    RAISE EXCEPTION 'league % is not in the keeper declaration phase', p_league_id;
  END IF;

  SELECT count(*) INTO v_kept_count
  FROM keeper_declarations
  WHERE league_id = p_league_id AND season = p_season;

  -- Release every rostered player that isn't a declared keeper. NOT EXISTS is
  -- null-safe and naturally releases the whole roster when zero keepers were
  -- declared (the original code's explicit no-keepers branch).
  WITH released AS (
    DELETE FROM league_players lp
    WHERE lp.league_id = p_league_id
      AND NOT EXISTS (
        SELECT 1 FROM keeper_declarations kd
        WHERE kd.league_id = p_league_id
          AND kd.season = p_season
          AND kd.player_id = lp.player_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_released_count FROM released;

  DELETE FROM keeper_declarations
  WHERE league_id = p_league_id AND season = p_season;

  UPDATE leagues
  SET offseason_step = 'ready_for_new_season'
  WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'kept_count', v_kept_count,
    'released_count', v_released_count
  );
END;
$$;

-- Internal helper: no auth check of its own (the edge function gates the call),
-- so only the service_role / definer may reach it.
REVOKE ALL ON FUNCTION public.finalize_keepers_atomic(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.finalize_keepers_atomic(uuid, text) FROM anon, authenticated;
