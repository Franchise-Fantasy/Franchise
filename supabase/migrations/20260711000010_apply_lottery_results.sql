-- Atomic lottery commit — and, more importantly, a lottery that can't be
-- re-rolled by a retry.
--
-- start-lottery's re-entry gate is `leagues.offseason_step IN ('lottery_pending',
-- 'lottery_scheduled')`, and it only closes in the LAST write. But the RNG runs
-- near the start. So any failure after the draw — a timeout, a crashed worker, a
-- double-tapped button — left the gate OPEN with results already persisted, and
-- the retry:
--
--   * ran runLotteryDraw() AGAIN, producing a DIFFERENT winner,
--   * upserted it over lottery_results (ON CONFLICT league_id,season), and
--   * re-derived the whole pick order from the new draw.
--
-- A lottery is a one-shot ceremony. Silently re-rolling it — after the first
-- result may already have been seen — is about the worst thing this app can do
-- to a league's trust. The draw itself must stay in TS (it's a weighted RNG),
-- so instead the gate is claimed in the SAME transaction as the results: the
-- second caller finds the gate closed and gets a 409 rather than a new winner.

CREATE OR REPLACE FUNCTION public.apply_lottery_results(
  p_league_id uuid,
  p_season text,
  p_results jsonb,
  p_pick_resolution jsonb,
  p_pick_assignments jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step text;
BEGIN
  -- Re-check the gate under FOR UPDATE. The edge function checks it up front
  -- for a friendly error; this closes the window between that read and the
  -- draw, and serializes two concurrent runs.
  SELECT offseason_step INTO v_step FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_step NOT IN ('lottery_pending', 'lottery_scheduled') THEN
    RAISE EXCEPTION 'lottery_already_run: league is at step %', v_step
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO lottery_results (league_id, season, results, pick_resolution, pick_assignments)
  VALUES (p_league_id, p_season, p_results, p_pick_resolution, p_pick_assignments)
  ON CONFLICT (league_id, season) DO UPDATE
    SET results          = EXCLUDED.results,
        pick_resolution  = EXCLUDED.pick_resolution,
        pick_assignments = EXCLUDED.pick_assignments;

  -- `lottery_revealing` is the intermediate step: the RNG has run and the
  -- results are persisted, but the ceremony hasn't been watched yet. Closing the
  -- gate HERE — with the results, not after them — is what makes the retry a
  -- no-op instead of a re-roll.
  UPDATE leagues
     SET lottery_status = 'complete',
         offseason_step = 'lottery_revealing'
   WHERE id = p_league_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_lottery_results(uuid, text, jsonb, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.apply_lottery_results(uuid, text, jsonb, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.apply_lottery_results(uuid, text, jsonb, jsonb, jsonb) FROM anon, authenticated;
