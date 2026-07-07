-- Security review 2026-07-07 — LOW: get_user_tier exposure + survey result visibility.

-- 1. get_user_tier(p_user_id, p_league_id) took an arbitrary user_id and had no
--    caller check, letting any authenticated user read anyone's subscription
--    tier. It has no client callers and no RLS-policy dependency, so revoke the
--    client grant entirely (service-role / internal callers keep access).
REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid, uuid) FROM authenticated, anon;

-- 2. get_survey_results only checked league membership, ignoring the survey's
--    results_visibility — so a member could read results of a 'commissioner'
--    (commissioner-only) survey by calling the RPC directly. Enforce the same
--    rule the client UI uses: the commissioner may always view results; other
--    members only when visibility is 'everyone' AND the survey has closed.
CREATE OR REPLACE FUNCTION public.get_survey_results(p_survey_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb := '[]'::jsonb;
  q record;
  total_responses int;
  q_result jsonb;
  v_league_id uuid;
  v_results_visibility text;
  v_closes_at timestamptz;
BEGIN
  SELECT cs.league_id, cs.results_visibility, cs.closes_at
  INTO v_league_id, v_results_visibility, v_closes_at
  FROM commissioner_surveys cs
  WHERE cs.id = p_survey_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Survey not found';
  END IF;

  IF NOT is_league_member(v_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  -- Results visibility: commissioner always; other members only when the survey
  -- is set to 'everyone' AND has closed.
  IF NOT is_league_commissioner(v_league_id)
     AND (v_results_visibility <> 'everyone' OR v_closes_at IS NULL OR v_closes_at > now()) THEN
    RAISE EXCEPTION 'Survey results are not available yet';
  END IF;

  SELECT count(*) INTO total_responses
  FROM survey_responses WHERE survey_id = p_survey_id;

  FOR q IN
    SELECT sq.id, sq.type, sq.options, sq.sort_order, sq.prompt
    FROM survey_questions sq
    WHERE sq.survey_id = p_survey_id
    ORDER BY sq.sort_order
  LOOP
    IF q.type IN ('multiple_choice_single', 'multiple_choice_multi') THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'options', q.options,
        'total_responses', total_responses,
        'option_counts', (
          SELECT coalesce(jsonb_agg(cnt ORDER BY idx), '[]'::jsonb)
          FROM (
            SELECT opt_idx.idx, count(sa.id) AS cnt
            FROM generate_series(0, jsonb_array_length(q.options) - 1) AS opt_idx(idx)
            LEFT JOIN survey_answers sa ON sa.question_id = q.id
              AND sa.value @> to_jsonb(opt_idx.idx)
            GROUP BY opt_idx.idx
          ) sub
        )
      ) INTO q_result;

    ELSIF q.type = 'rating' THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'total_responses', total_responses,
        'distribution', (
          SELECT coalesce(jsonb_object_agg(r::text, coalesce(sub.cnt, 0)), '{}'::jsonb)
          FROM generate_series(1, 5) AS r
          LEFT JOIN (
            SELECT (sa.value)::int AS rating, count(*) AS cnt
            FROM survey_answers sa WHERE sa.question_id = q.id
            GROUP BY (sa.value)::int
          ) sub ON sub.rating = r
        ),
        'average', (
          SELECT coalesce(round(avg((sa.value)::numeric), 2), 0)
          FROM survey_answers sa WHERE sa.question_id = q.id
        )
      ) INTO q_result;

    ELSIF q.type = 'free_text' THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'total_responses', total_responses,
        'responses', (
          SELECT coalesce(jsonb_agg(sa.value #>> '{}'), '[]'::jsonb)
          FROM survey_answers sa WHERE sa.question_id = q.id
        )
      ) INTO q_result;

    ELSIF q.type = 'ranked_choice' THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'options', q.options,
        'total_responses', total_responses,
        'borda_scores', (
          SELECT coalesce(jsonb_agg(score ORDER BY idx), '[]'::jsonb)
          FROM (
            SELECT opt_idx.idx,
              coalesce(sum(
                jsonb_array_length(q.options) - 1 -
                (SELECT pos FROM generate_series(0, jsonb_array_length(sa.value) - 1) AS pos
                 WHERE (sa.value -> pos)::int = opt_idx.idx LIMIT 1)
              ), 0) AS score
            FROM generate_series(0, jsonb_array_length(q.options) - 1) AS opt_idx(idx)
            LEFT JOIN survey_answers sa ON sa.question_id = q.id
            GROUP BY opt_idx.idx
          ) sub
        )
      ) INTO q_result;
    END IF;

    result := result || q_result;
  END LOOP;

  RETURN result;
END;
$function$;
