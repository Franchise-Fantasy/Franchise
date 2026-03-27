-- Fix poll messages showing UUID in conversation preview
-- Show "📊 Poll" instead of the poll ID
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
      CASE
        WHEN msg.type = 'poll' THEN '📊 Poll'
        WHEN msg.type = 'survey' THEN '📋 Survey'
        ELSE msg.content
      END AS content,
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
