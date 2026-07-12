-- Atomic schedule writer. generate-schedule previously (1) inserted
-- league_schedule week rows, (2) inserted league_matchups, then (3) flipped
-- leagues.schedule_generated=true as three separate PostgREST calls. The gate
-- (schedule_generated) was read at the top and only set in write (3), and there
-- is NO unique index on league_schedule — so:
--   * a failure between (1) and (3) left schedule_generated=false, and a retry
--     inserted a SECOND full set of weeks + matchups; and
--   * two concurrent callers (the auth path allows any member once every team is
--     claimed, plus double-taps) both read false and both inserted.
-- Either way every week ended up with 2x matchups and scoring/standings were
-- corrupted for the season.
--
-- This function folds an OPTIMISTIC CLAIM and both inserts into one transaction:
-- it flips schedule_generated false->true with a conditional UPDATE and aborts
-- if 0 rows match (someone else already generated / is racing), then inserts the
-- weeks and matchups. The heavy row generation (round-robin + merge-window/double
-- -week planning) stays in TS and is passed in as JSONB, so there is no SQL<->TS
-- logic to drift. Matchups carry week_number and are joined to the freshly
-- inserted week ids inside the same statement to resolve schedule_id.
--
-- p_weeks:    [{ week_number, start_date, end_date, is_playoff, is_double_week, season }]
-- p_matchups: [{ week_number, home_team_id, away_team_id }]  (away_team_id null = bye)
-- Returns: { week_count, matchup_count }

CREATE OR REPLACE FUNCTION public.generate_schedule_atomic(
  p_league_id uuid,
  p_weeks jsonb,
  p_matchups jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed uuid;
  v_week_count integer;
  v_matchup_count integer;
BEGIN
  -- Optimistic claim: only one caller can flip false->true. A concurrent or
  -- retried call matches 0 rows and aborts before inserting anything.
  UPDATE leagues
  SET schedule_generated = true, offseason_step = NULL
  WHERE id = p_league_id AND schedule_generated = false
  RETURNING id INTO v_claimed;

  IF v_claimed IS NULL THEN
    RAISE EXCEPTION 'schedule already generated for league %', p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Insert weeks, then matchups joined to the just-inserted week ids by
  -- week_number — all in one statement so the schedule_id resolution and both
  -- inserts share the claim's transaction.
  WITH ins_weeks AS (
    INSERT INTO league_schedule
      (league_id, week_number, start_date, end_date, is_playoff, is_double_week, season)
    SELECT
      p_league_id,
      (w->>'week_number')::integer,
      (w->>'start_date')::date,
      (w->>'end_date')::date,
      (w->>'is_playoff')::boolean,
      (w->>'is_double_week')::boolean,
      (w->>'season')::text
    FROM jsonb_array_elements(p_weeks) AS w
    RETURNING id, week_number
  ),
  ins_matchups AS (
    INSERT INTO league_matchups
      (league_id, schedule_id, week_number, home_team_id, away_team_id)
    SELECT
      p_league_id,
      iw.id,
      (m->>'week_number')::integer,
      (m->>'home_team_id')::uuid,
      (m->>'away_team_id')::uuid
    FROM jsonb_array_elements(p_matchups) AS m
    JOIN ins_weeks iw ON iw.week_number = (m->>'week_number')::integer
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM ins_weeks),
    (SELECT count(*) FROM ins_matchups)
  INTO v_week_count, v_matchup_count;

  RETURN jsonb_build_object(
    'week_count', v_week_count,
    'matchup_count', v_matchup_count
  );
END;
$$;

-- Service-role / definer only (the edge function owns the commissioner/all-
-- claimed auth check and calls with the service key). REVOKE from public AND
-- anon/authenticated — stripping only one leaves the other reachable.
GRANT EXECUTE ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.generate_schedule_atomic(uuid, jsonb, jsonb) FROM anon, authenticated;
