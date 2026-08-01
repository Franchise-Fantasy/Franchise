-- Exempt system-authored message types (polls, surveys, trade records, trade
-- updates, rumors) from the blocked-user chat filter. All five carry a
-- team_id, so they were being hidden as if they were the sender's personal
-- speech. Three distinct problems:
--
--   * poll / survey: inserted with the commissioner's team_id (create-poll /
--     create-survey), so a member who blocks the commissioner silently stops
--     seeing league business — votes, dues surveys, deadline polls — with no
--     indication anything is hidden.
--   * trade / trade_update: auditable league history (the same reason they're
--     not unsendable); blocking a member shouldn't erase completed-trade
--     records from your view of the league.
--   * rumor: anonymous ("league source") but stamped with the submitter's
--     team_id (leak_trade_rumor). The block filter was a deanonymization side
--     channel — block a suspect and watch whether the rumor disappears.
--     There is no abuse tradeoff in exempting them: rumor text is a fixed
--     template from RUMOR_TEMPLATES plus a player name, so a blocked user
--     cannot author anything through it.
--
-- This migration ALSO stops returning the rumor author's team_id from
-- get_messages_page (see the CASE below). The block filter was only the
-- visible symptom; the raw column was being handed to every client on the
-- normal read path, so anyone inspecting the response could deanonymize every
-- rumor in their league.
--
-- RESIDUAL (not closed here, needs a decision): chat_messages.team_id is
-- still readable by a determined member via a direct
-- `from('chat_messages').select()` — the SELECT policy is row-level and
-- cannot redact one column for one message type. Closing it properly means
-- not storing the submitter on the chat row at all (move authorship to a
-- moderation-only table and NULL the existing rows), which is a data
-- migration over live rumors. Filed rather than done.
--
-- Blocking is meant to mute a *person's* speech (text/image/gif/DMs);
-- `announcement` already escapes the filter via `team_id IS NULL`, and this
-- puts the other system types in the same bucket despite their non-null
-- team_id.
--
-- The client no longer offers Block on any of these types (Report survives
-- only on rumors — their text is user-authored), and the block confirm warns
-- a commissioner-blocker that official content stays visible
-- (app/chat/[id].tsx, same commit).
--
-- Four sites carry the block predicate and all must move together:
--   1. chat_messages SELECT policy        (20260426010001)
--   2. get_messages_page                  (20260426010001)
--   3. get_conversations                  (20260521000002)
--   4. get_total_unread                   (20260521000002)

-- ─── 1. chat_messages SELECT policy ─────────────────────────────

DROP POLICY IF EXISTS "Conversation members can read messages" ON chat_messages;
CREATE POLICY "Conversation members can read messages" ON chat_messages
  FOR SELECT TO authenticated
  USING (
    is_conversation_member(conversation_id)
    AND (
      team_id IS NULL
      OR type IN ('poll', 'survey', 'trade', 'trade_update', 'rumor')
      OR NOT is_team_blocked_by_me(team_id)
    )
  );

-- ─── 2. get_messages_page ───────────────────────────────────────
-- Same return shape as 20260426010001; only the block predicate gains the
-- poll/survey exemption.

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
    -- Rumors are anonymous "league source" posts, but the row stores the
    -- submitter's team so the commissioner can moderate. Returning it handed
    -- every client the author (the block-filter leak was only the visible
    -- symptom). NULL it here so no UI can surface it. See the residual note
    -- in this migration's header.
    CASE WHEN m.type = 'rumor' THEN NULL ELSE m.team_id END AS team_id,
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
      OR m.type IN ('poll', 'survey', 'trade', 'trade_update', 'rumor')
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

-- ─── 3. get_conversations ───────────────────────────────────────
-- Same body as 20260521000002; the poll/survey exemption is added to both the
-- preview CTE and the unread-count CTE so a visible message also previews and
-- badges.

CREATE OR REPLACE FUNCTION public.get_conversations(p_league_id uuid, p_team_id uuid)
 RETURNS TABLE(id uuid, league_id uuid, type text, created_at timestamp with time zone, last_message text, last_message_at timestamp with time zone, last_message_team_name text, unread_count bigint, other_team_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH my_memberships AS (
    SELECT cm.conversation_id, cm.last_read_at
    FROM chat_members cm
    JOIN chat_conversations cc ON cc.id = cm.conversation_id
    -- Auth: verify caller owns this team
    JOIN teams t_auth ON t_auth.id = cm.team_id
      AND t_auth.user_id = (SELECT auth.uid())
    WHERE cm.team_id = p_team_id AND cc.league_id = p_league_id
  ),
  latest_msgs AS (
    SELECT DISTINCT ON (msg.conversation_id)
      msg.conversation_id,
      CASE
        WHEN msg.type = 'poll'         THEN '📊 Poll'
        WHEN msg.type = 'survey'       THEN '📋 Survey'
        WHEN msg.type = 'trade'        THEN '🤝 Trade Completed'
        WHEN msg.type = 'rumor'        THEN '👀 Rumor'
        WHEN msg.type = 'image'        THEN '📷 Photo'
        WHEN msg.type = 'gif'          THEN 'GIF'
        WHEN msg.type = 'trade_update' THEN '📨 Trade Update'
        ELSE msg.content
      END AS content,
      msg.created_at,
      CASE
        WHEN msg.type IN ('trade', 'rumor', 'trade_update') THEN NULL
        ELSE t.name
      END AS team_name
    FROM chat_messages msg
    JOIN my_memberships mm ON mm.conversation_id = msg.conversation_id
    LEFT JOIN teams t ON t.id = msg.team_id
    WHERE (
      msg.team_id IS NULL
      OR msg.type IN ('poll', 'survey', 'trade', 'trade_update', 'rumor')
      OR NOT EXISTS (
        SELECT 1
        FROM teams t2
        JOIN user_blocks ub ON ub.blocked_id = t2.user_id
        WHERE t2.id = msg.team_id
          AND ub.blocker_id = (SELECT auth.uid())
      )
    )
    ORDER BY msg.conversation_id, msg.created_at DESC
  ),
  unread_counts AS (
    SELECT msg.conversation_id, COUNT(*) AS cnt
    FROM chat_messages msg
    JOIN my_memberships mm ON mm.conversation_id = msg.conversation_id
    WHERE msg.team_id IS DISTINCT FROM p_team_id
      AND msg.created_at > mm.last_read_at
      AND (
        msg.team_id IS NULL
        OR msg.type IN ('poll', 'survey', 'trade', 'trade_update', 'rumor')
        OR NOT EXISTS (
          SELECT 1
          FROM teams t2
          JOIN user_blocks ub ON ub.blocked_id = t2.user_id
          WHERE t2.id = msg.team_id
            AND ub.blocker_id = (SELECT auth.uid())
        )
      )
    GROUP BY msg.conversation_id
  ),
  dm_names AS (
    SELECT cm2.conversation_id, t.name
    FROM chat_members cm2
    JOIN my_memberships mm ON mm.conversation_id = cm2.conversation_id
    JOIN chat_conversations cc ON cc.id = cm2.conversation_id
    JOIN teams t ON t.id = cm2.team_id
    WHERE cc.type = 'dm' AND cm2.team_id <> p_team_id
  ),
  trade_names AS (
    SELECT cm2.conversation_id,
      string_agg(t.name, ', ' ORDER BY t.name) AS name
    FROM chat_members cm2
    JOIN my_memberships mm ON mm.conversation_id = cm2.conversation_id
    JOIN chat_conversations cc ON cc.id = cm2.conversation_id
    JOIN teams t ON t.id = cm2.team_id
    WHERE cc.type = 'trade' AND cm2.team_id <> p_team_id
    GROUP BY cm2.conversation_id
  )
  SELECT
    cc.id,
    cc.league_id,
    cc.type,
    cc.created_at,
    lm.content AS last_message,
    lm.created_at AS last_message_at,
    lm.team_name AS last_message_team_name,
    COALESCE(uc.cnt, 0) AS unread_count,
    COALESCE(dn.name, tn.name) AS other_team_name
  FROM my_memberships mm
  JOIN chat_conversations cc ON cc.id = mm.conversation_id
  LEFT JOIN latest_msgs lm ON lm.conversation_id = cc.id
  LEFT JOIN unread_counts uc ON uc.conversation_id = cc.id
  LEFT JOIN dm_names dn ON dn.conversation_id = cc.id
  LEFT JOIN trade_names tn ON tn.conversation_id = cc.id
  ORDER BY
    (cc.type = 'league') DESC,
    COALESCE(lm.created_at, cc.created_at) DESC;
$function$;

-- ─── 4. get_total_unread ────────────────────────────────────────
-- NB: `msg.team_id <> p_team_id` already excludes team_id-NULL system rows
-- from the total (NULL comparison), so only the block predicate changes.

CREATE OR REPLACE FUNCTION public.get_total_unread(p_league_id uuid, p_team_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(DISTINCT msg.conversation_id)
  FROM chat_members cm
  JOIN chat_conversations cc ON cc.id = cm.conversation_id
  JOIN chat_messages msg ON msg.conversation_id = cm.conversation_id
  WHERE cm.team_id = p_team_id
    AND cc.league_id = p_league_id
    AND msg.team_id <> p_team_id
    AND msg.created_at > cm.last_read_at
    -- Skip messages from teams the caller has blocked (system-authored types
    -- stay visible, so they stay counted)
    AND (
      msg.type IN ('poll', 'survey', 'trade', 'trade_update', 'rumor')
      OR NOT EXISTS (
        SELECT 1
        FROM teams t2
        JOIN user_blocks ub ON ub.blocked_id = t2.user_id
        WHERE t2.id = msg.team_id
          AND ub.blocker_id = (SELECT auth.uid())
      )
    )
    -- Auth: verify caller owns this team
    AND EXISTS (
      SELECT 1 FROM teams t_auth
      WHERE t_auth.id = p_team_id
        AND t_auth.user_id = (SELECT auth.uid())
    );
$function$;
