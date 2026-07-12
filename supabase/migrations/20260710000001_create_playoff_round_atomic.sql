-- Atomic playoff-round writer. generate-playoff-round previously inserted
-- league_matchups rows and then playoff_bracket rows in two separate PostgREST
-- calls (plus a third for the 3rd-place game). A failure between them left
-- orphan matchups with no bracket — and, on a re-run, could duplicate matchups.
-- This function performs every matchup + bracket insert for a round inside one
-- transaction (plpgsql functions are atomic), so the round is all-or-nothing.
--
-- Inputs:
--   p_pairings   jsonb array of
--                {bracket_position, team_a_id, team_a_seed, team_b_id, team_b_seed, is_bye}
--                (team_b_* are null for byes)
--   p_third_place jsonb {bracket_position, team_a_id, team_a_seed, team_b_id, team_b_seed}
--                or null
-- Returns: { bracket_count, matchup_count, matchups: [{team_a_id, team_b_id, is_third_place}] }
--   (matchups drives the edge function's push fan-out — byes are omitted.)

CREATE OR REPLACE FUNCTION public.create_playoff_round_atomic(
  p_league_id uuid,
  p_season text,
  p_round integer,
  p_schedule_id uuid,
  p_week_number integer,
  p_pairings jsonb,
  p_third_place jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairing jsonb;
  v_matchup_id uuid;
  v_matchups jsonb := '[]'::jsonb;
  v_bracket_count integer := 0;
  v_matchup_count integer := 0;
BEGIN
  -- Race-safe guard: never regenerate an existing round (the edge function also
  -- checks up front; this closes the gap between its check and this write).
  IF EXISTS (
    SELECT 1 FROM playoff_bracket
    WHERE league_id = p_league_id AND season = p_season AND round = p_round
  ) THEN
    RAISE EXCEPTION 'round % already generated', p_round USING ERRCODE = 'unique_violation';
  END IF;

  FOR v_pairing IN SELECT jsonb_array_elements(p_pairings)
  LOOP
    IF COALESCE((v_pairing->>'is_bye')::boolean, false) THEN
      INSERT INTO playoff_bracket (
        league_id, season, round, bracket_position, matchup_id,
        team_a_id, team_a_seed, team_b_id, team_b_seed,
        winner_id, is_bye, is_third_place
      ) VALUES (
        p_league_id, p_season, p_round, (v_pairing->>'bracket_position')::integer, NULL,
        (v_pairing->>'team_a_id')::uuid, (v_pairing->>'team_a_seed')::integer, NULL, NULL,
        (v_pairing->>'team_a_id')::uuid, true, false
      );
      v_bracket_count := v_bracket_count + 1;
    ELSE
      INSERT INTO league_matchups (
        league_id, schedule_id, week_number, home_team_id, away_team_id, playoff_round
      ) VALUES (
        p_league_id, p_schedule_id, p_week_number,
        (v_pairing->>'team_a_id')::uuid, (v_pairing->>'team_b_id')::uuid, p_round
      ) RETURNING id INTO v_matchup_id;

      INSERT INTO playoff_bracket (
        league_id, season, round, bracket_position, matchup_id,
        team_a_id, team_a_seed, team_b_id, team_b_seed,
        winner_id, is_bye, is_third_place
      ) VALUES (
        p_league_id, p_season, p_round, (v_pairing->>'bracket_position')::integer, v_matchup_id,
        (v_pairing->>'team_a_id')::uuid, (v_pairing->>'team_a_seed')::integer,
        (v_pairing->>'team_b_id')::uuid, (v_pairing->>'team_b_seed')::integer,
        NULL, false, false
      );

      v_bracket_count := v_bracket_count + 1;
      v_matchup_count := v_matchup_count + 1;
      v_matchups := v_matchups || jsonb_build_object(
        'team_a_id', v_pairing->>'team_a_id',
        'team_b_id', v_pairing->>'team_b_id',
        'is_third_place', false
      );
    END IF;
  END LOOP;

  IF p_third_place IS NOT NULL THEN
    INSERT INTO league_matchups (
      league_id, schedule_id, week_number, home_team_id, away_team_id, playoff_round
    ) VALUES (
      p_league_id, p_schedule_id, p_week_number,
      (p_third_place->>'team_a_id')::uuid, (p_third_place->>'team_b_id')::uuid, p_round
    ) RETURNING id INTO v_matchup_id;

    INSERT INTO playoff_bracket (
      league_id, season, round, bracket_position, matchup_id,
      team_a_id, team_a_seed, team_b_id, team_b_seed,
      winner_id, is_bye, is_third_place
    ) VALUES (
      p_league_id, p_season, p_round, (p_third_place->>'bracket_position')::integer, v_matchup_id,
      (p_third_place->>'team_a_id')::uuid, (p_third_place->>'team_a_seed')::integer,
      (p_third_place->>'team_b_id')::uuid, (p_third_place->>'team_b_seed')::integer,
      NULL, false, true
    );

    v_bracket_count := v_bracket_count + 1;
    v_matchup_count := v_matchup_count + 1;
    v_matchups := v_matchups || jsonb_build_object(
      'team_a_id', p_third_place->>'team_a_id',
      'team_b_id', p_third_place->>'team_b_id',
      'is_third_place', true
    );
  END IF;

  RETURN jsonb_build_object(
    'bracket_count', v_bracket_count,
    'matchup_count', v_matchup_count,
    'matchups', v_matchups
  );
END;
$$;

-- Internal helper: no auth check of its own (the edge function gates the call),
-- so only the service_role / definer may reach it.
REVOKE ALL ON FUNCTION public.create_playoff_round_atomic(uuid, text, integer, uuid, integer, jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.create_playoff_round_atomic(uuid, text, integer, uuid, integer, jsonb, jsonb) FROM anon, authenticated;
