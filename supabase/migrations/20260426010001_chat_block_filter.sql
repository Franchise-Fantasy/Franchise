-- Wire user_blocks into the chat read path. Two edits are required because
-- chat reads happen via two distinct paths:
--
--   1. Direct  `from('chat_messages').select(...)` queries respect the
--      SELECT policy. We add a NOT-blocked predicate to the policy.
--
--   2. The `get_messages_page` RPC is SECURITY DEFINER and bypasses RLS, so
--      the same predicate must be inlined into its query.
--
-- A blocker hides messages whose `team_id` belongs to a user they've blocked.
-- chat_messages.team_id can be NULL for system messages — those are never
-- filtered.

-- Helper: which team_ids belong to users I've blocked?
CREATE OR REPLACE FUNCTION public.is_team_blocked_by_me(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM teams t
    JOIN user_blocks ub ON ub.blocked_id = t.user_id
    WHERE t.id = p_team_id
      AND ub.blocker_id = (SELECT auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_team_blocked_by_me(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_team_blocked_by_me(uuid) TO authenticated, service_role;

-- ─── chat_messages SELECT policy ────────────────────────────────

DROP POLICY IF EXISTS "Conversation members can read messages" ON chat_messages;
CREATE POLICY "Conversation members can read messages" ON chat_messages
  FOR SELECT TO authenticated
  USING (
    is_conversation_member(conversation_id)
    AND (team_id IS NULL OR NOT is_team_blocked_by_me(team_id))
  );

-- ─── get_messages_page: filter blocked-team messages ────────────
-- Same return shape as the existing function (see 20260426000000_rls_perf_helpers.sql);
-- we add a NOT-EXISTS clause and keep everything else identical.

CREATE OR REPLACE FUNCTION public.get_messages_page(
  p_conversation_id uuid,
  p_cursor timestamp with time zone DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  team_id uuid,
  content text,
  type text,
  created_at timestamp with time zone,
  team_name text,
  poll_question text,
  poll_options jsonb,
  poll_type text,
  poll_closes_at timestamp with time zone,
  poll_is_anonymous boolean,
  poll_show_live_results boolean,
  trade_summary jsonb,
  survey_title text,
  survey_description text,
  survey_question_count bigint,
  survey_closes_at timestamp with time zone,
  survey_results_visibility text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Not a conversation member';
  END IF;

  RETURN QUERY
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
      m.team_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM teams t2
        JOIN user_blocks ub ON ub.blocked_id = t2.user_id
        WHERE t2.id = m.team_id
          AND ub.blocker_id = (SELECT auth.uid())
      )
    )
    AND (
      p_cursor IS NULL
      OR (m.created_at, m.id) < (p_cursor, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit;
END;
$function$;
