-- ============================================================
-- Commissioner Surveys
-- Multi-question surveys announced in league chat
-- ============================================================

-- 1. Tables
-- ----------------------------------------------------------

CREATE TABLE commissioner_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES chat_messages(id),
  team_id uuid NOT NULL REFERENCES teams(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  results_visibility text NOT NULL DEFAULT 'commissioner' CHECK (results_visibility IN ('everyone', 'commissioner')),
  closes_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_surveys_league ON commissioner_surveys(league_id);
CREATE INDEX idx_surveys_message ON commissioner_surveys(message_id);

CREATE TABLE survey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES commissioner_surveys(id) ON DELETE CASCADE,
  sort_order smallint NOT NULL,
  type text NOT NULL CHECK (type IN ('multiple_choice_single', 'multiple_choice_multi', 'free_text', 'rating', 'ranked_choice')),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 500),
  options jsonb,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (survey_id, sort_order)
);

CREATE INDEX idx_survey_questions_survey ON survey_questions(survey_id);

CREATE TABLE survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES commissioner_surveys(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id),
  submitted_at timestamptz DEFAULT now(),
  UNIQUE (survey_id, team_id)
);

CREATE INDEX idx_survey_responses_survey ON survey_responses(survey_id);

CREATE TABLE survey_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  UNIQUE (response_id, question_id)
);

CREATE INDEX idx_survey_answers_response ON survey_answers(response_id);
CREATE INDEX idx_survey_answers_question ON survey_answers(question_id);

-- 2. RLS
-- ----------------------------------------------------------

ALTER TABLE commissioner_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_answers ENABLE ROW LEVEL SECURITY;

-- League members can read surveys for their league
CREATE POLICY "League members can read surveys"
  ON commissioner_surveys FOR SELECT
  USING (league_id IN (SELECT league_id FROM teams WHERE user_id = auth.uid()));

-- League members can read questions for surveys in their league
CREATE POLICY "League members can read survey questions"
  ON survey_questions FOR SELECT
  USING (survey_id IN (
    SELECT id FROM commissioner_surveys
    WHERE league_id IN (SELECT league_id FROM teams WHERE user_id = auth.uid())
  ));

-- Members can read own responses
CREATE POLICY "Members can read own survey responses"
  ON survey_responses FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Commissioner can read all responses (completion tracking)
CREATE POLICY "Commissioner can read all survey responses"
  ON survey_responses FOR SELECT
  USING (survey_id IN (
    SELECT cs.id FROM commissioner_surveys cs
    JOIN leagues l ON l.id = cs.league_id
    WHERE l.created_by = auth.uid()
  ));

-- Members can read own answers
CREATE POLICY "Members can read own survey answers"
  ON survey_answers FOR SELECT
  USING (response_id IN (
    SELECT id FROM survey_responses
    WHERE team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())
  ));

-- 3. RPC: get_survey_results
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION get_survey_results(p_survey_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  result jsonb := '[]'::jsonb;
  q record;
  total_responses int;
  q_result jsonb;
BEGIN
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
$$;

-- 4. Update get_messages_page to include survey data
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION get_messages_page(
  p_conversation_id uuid,
  p_cursor timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  team_id uuid,
  content text,
  type text,
  created_at timestamptz,
  team_name text,
  poll_question text,
  poll_options jsonb,
  poll_type text,
  poll_closes_at timestamptz,
  poll_is_anonymous boolean,
  poll_show_live_results boolean,
  survey_title text,
  survey_description text,
  survey_question_count bigint,
  survey_closes_at timestamptz,
  survey_results_visibility text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT
    m.id,
    m.conversation_id,
    m.team_id,
    m.content,
    m.type,
    m.created_at,
    t.name AS team_name,
    cp.question AS poll_question,
    cp.options AS poll_options,
    cp.poll_type,
    cp.closes_at AS poll_closes_at,
    cp.is_anonymous AS poll_is_anonymous,
    cp.show_live_results AS poll_show_live_results,
    cs.title AS survey_title,
    cs.description AS survey_description,
    (SELECT count(*) FROM survey_questions sq WHERE sq.survey_id = cs.id) AS survey_question_count,
    cs.closes_at AS survey_closes_at,
    cs.results_visibility AS survey_results_visibility
  FROM chat_messages m
  LEFT JOIN teams t ON t.id = m.team_id
  LEFT JOIN commissioner_polls cp ON m.type = 'poll' AND cp.message_id = m.id
  LEFT JOIN commissioner_surveys cs ON m.type = 'survey' AND cs.message_id = m.id
  WHERE m.conversation_id = p_conversation_id
    AND (
      p_cursor IS NULL
      OR (m.created_at, m.id) < (p_cursor, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit;
$$;
