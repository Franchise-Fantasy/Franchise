-- ============================================================
-- Chat Schema Improvements
-- Adds denormalized columns for realtime filtering,
-- cursor pagination index, and RPCs to replace client-side
-- query waterfalls.
-- ============================================================

-- 1a. Add league_id to chat_messages for realtime filtering
ALTER TABLE chat_messages ADD COLUMN league_id uuid REFERENCES leagues(id);

UPDATE chat_messages cm
SET league_id = cc.league_id
FROM chat_conversations cc
WHERE cm.conversation_id = cc.id AND cm.league_id IS NULL;

ALTER TABLE chat_messages ALTER COLUMN league_id SET NOT NULL;

CREATE INDEX idx_chat_messages_league ON chat_messages(league_id);

-- 1b. Add conversation_id to chat_reactions for realtime filtering
ALTER TABLE chat_reactions ADD COLUMN conversation_id uuid REFERENCES chat_conversations(id);

UPDATE chat_reactions cr
SET conversation_id = cm.conversation_id
FROM chat_messages cm
WHERE cr.message_id = cm.id AND cr.conversation_id IS NULL;

ALTER TABLE chat_reactions ALTER COLUMN conversation_id SET NOT NULL;

CREATE INDEX idx_chat_reactions_conversation ON chat_reactions(conversation_id);

-- 1c. Cursor pagination index (includes id for tie-breaking)
CREATE INDEX idx_chat_messages_cursor
ON chat_messages(conversation_id, created_at DESC, id DESC);

-- ============================================================
-- RPCs
-- ============================================================

-- 2a. get_conversations: replaces 4-query waterfall
CREATE OR REPLACE FUNCTION get_conversations(p_league_id uuid, p_team_id uuid)
RETURNS TABLE (
  id uuid,
  league_id uuid,
  type text,
  created_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  last_message_team_name text,
  unread_count bigint,
  other_team_name text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  WITH my_memberships AS (
    SELECT cm.conversation_id, cm.last_read_at
    FROM chat_members cm
    JOIN chat_conversations cc ON cc.id = cm.conversation_id
    WHERE cm.team_id = p_team_id AND cc.league_id = p_league_id
  ),
  latest_msgs AS (
    SELECT DISTINCT ON (msg.conversation_id)
      msg.conversation_id,
      CASE WHEN msg.type = 'poll' THEN '📊 Poll' ELSE msg.content END AS content,
      msg.created_at,
      t.name AS team_name
    FROM chat_messages msg
    JOIN my_memberships mm ON mm.conversation_id = msg.conversation_id
    LEFT JOIN teams t ON t.id = msg.team_id
    ORDER BY msg.conversation_id, msg.created_at DESC
  ),
  unread_counts AS (
    SELECT msg.conversation_id, COUNT(*) AS cnt
    FROM chat_messages msg
    JOIN my_memberships mm ON mm.conversation_id = msg.conversation_id
    WHERE msg.team_id <> p_team_id
      AND msg.created_at > mm.last_read_at
    GROUP BY msg.conversation_id
  ),
  dm_names AS (
    SELECT cm2.conversation_id, t.name
    FROM chat_members cm2
    JOIN my_memberships mm ON mm.conversation_id = cm2.conversation_id
    JOIN chat_conversations cc ON cc.id = cm2.conversation_id
    JOIN teams t ON t.id = cm2.team_id
    WHERE cc.type = 'dm' AND cm2.team_id <> p_team_id
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
    dn.name AS other_team_name
  FROM my_memberships mm
  JOIN chat_conversations cc ON cc.id = mm.conversation_id
  LEFT JOIN latest_msgs lm ON lm.conversation_id = cc.id
  LEFT JOIN unread_counts uc ON uc.conversation_id = cc.id
  LEFT JOIN dm_names dn ON dn.conversation_id = cc.id
  ORDER BY
    (cc.type = 'league') DESC,
    COALESCE(lm.created_at, cc.created_at) DESC;
$$;

-- 2b. get_total_unread: lightweight badge count
CREATE OR REPLACE FUNCTION get_total_unread(p_league_id uuid, p_team_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT COUNT(DISTINCT msg.conversation_id)
  FROM chat_members cm
  JOIN chat_conversations cc ON cc.id = cm.conversation_id
  JOIN chat_messages msg ON msg.conversation_id = cm.conversation_id
  WHERE cm.team_id = p_team_id
    AND cc.league_id = p_league_id
    AND msg.team_id <> p_team_id
    AND msg.created_at > cm.last_read_at;
$$;

-- 2c. get_messages_page: cursor-based pagination with embedded poll data
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
  poll_show_live_results boolean
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
    cp.show_live_results AS poll_show_live_results
  FROM chat_messages m
  LEFT JOIN teams t ON t.id = m.team_id
  LEFT JOIN commissioner_polls cp ON m.type = 'poll' AND cp.message_id = m.id
  WHERE m.conversation_id = p_conversation_id
    AND (
      p_cursor IS NULL
      OR (m.created_at, m.id) < (p_cursor, p_cursor_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit;
$$;
