-- Add trade_summary to get_messages_page RPC so trade bubbles render properly in chat

-- Safe UUID cast helper — returns NULL instead of throwing on invalid input
CREATE OR REPLACE FUNCTION try_cast_uuid(val text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN val::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

DROP FUNCTION IF EXISTS get_messages_page(uuid, timestamptz, uuid, int);

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
  trade_summary jsonb,
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
    tp.trade_summary,
    cs.title AS survey_title,
    cs.description AS survey_description,
    (SELECT count(*) FROM survey_questions sq WHERE sq.survey_id = cs.id) AS survey_question_count,
    cs.closes_at AS survey_closes_at,
    cs.results_visibility AS survey_results_visibility
  FROM chat_messages m
  LEFT JOIN teams t ON t.id = m.team_id
  LEFT JOIN commissioner_polls cp ON m.type = 'poll' AND cp.message_id = m.id
  LEFT JOIN trade_proposals tp ON tp.id = try_cast_uuid(m.content)
    AND m.type = 'trade'
  LEFT JOIN commissioner_surveys cs ON m.type = 'survey' AND cs.message_id = m.id
  WHERE m.conversation_id = p_conversation_id
    AND (
      p_cursor IS NULL
      OR (m.created_at, m.id) < (p_cursor, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit;
$$;
