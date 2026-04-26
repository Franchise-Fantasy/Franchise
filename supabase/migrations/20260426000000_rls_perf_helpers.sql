-- Adds is_conversation_member() helper and consolidates chat policies that
-- currently do multi-table EXISTS joins to use the existing helpers
-- (is_league_member, is_league_commissioner). The planner can cache STABLE
-- function results per call, and the helpers centralize the membership
-- check (so future schema changes touch one definition, not five policies).

CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN teams t ON t.id = cm.team_id
    WHERE cm.conversation_id = p_conversation_id
      AND t.user_id = (SELECT auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated, service_role;

-- ─── chat_messages ──────────────────────────────────────────────
-- Hot-path SELECT policy. Replace inline 2-table JOIN with the helper.

DROP POLICY IF EXISTS "Conversation members can read messages" ON chat_messages;
CREATE POLICY "Conversation members can read messages" ON chat_messages
  FOR SELECT TO authenticated
  USING (is_conversation_member(conversation_id));

-- INSERT keeps the team-ownership check inline (it's per-row by design)
DROP POLICY IF EXISTS "Members can send messages" ON chat_messages;
CREATE POLICY "Members can send messages" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      team_id IS NOT NULL
      AND team_id IN (SELECT id FROM teams WHERE user_id = (SELECT auth.uid()))
      AND EXISTS (
        SELECT 1 FROM chat_members cm
        WHERE cm.conversation_id = chat_messages.conversation_id
          AND cm.team_id = chat_messages.team_id
      )
    )
    OR (
      team_id IS NULL
      AND is_conversation_member(conversation_id)
    )
  );

-- ─── chat_reactions ─────────────────────────────────────────────
-- Reactions don't carry conversation_id directly — must hop through
-- chat_messages. Wrap that hop in a STABLE helper so the planner can cache
-- by message_id within a query.

CREATE OR REPLACE FUNCTION public.can_view_message(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_messages m
    WHERE m.id = p_message_id
      AND is_conversation_member(m.conversation_id)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_message(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.can_view_message(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Conversation members can read reactions" ON chat_reactions;
CREATE POLICY "Conversation members can read reactions" ON chat_reactions
  FOR SELECT TO authenticated
  USING (can_view_message(message_id));

-- ─── chat_pins ──────────────────────────────────────────────────
-- Use is_league_commissioner() helper instead of inline 2-table JOIN.

DROP POLICY IF EXISTS "Members can read pins" ON chat_pins;
CREATE POLICY "Members can read pins" ON chat_pins
  FOR SELECT TO authenticated
  USING (is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "Commissioner can pin" ON chat_pins;
CREATE POLICY "Commissioner can pin" ON chat_pins
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations cc
      WHERE cc.id = chat_pins.conversation_id
        AND is_league_commissioner(cc.league_id)
    )
  );

DROP POLICY IF EXISTS "Commissioner can unpin" ON chat_pins;
CREATE POLICY "Commissioner can unpin" ON chat_pins
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_conversations cc
      WHERE cc.id = chat_pins.conversation_id
        AND is_league_commissioner(cc.league_id)
    )
  );

-- ─── get_messages_page: hoist auth check out of WHERE ───────────
-- Currently the function checks membership inside the WHERE clause via
-- EXISTS (which the planner *should* hoist as an InitPlan, but explicit
-- is better than implicit, and lets us return early on 401).

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
      p_cursor IS NULL
      OR (m.created_at, m.id) < (p_cursor, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit;
END;
$function$;
