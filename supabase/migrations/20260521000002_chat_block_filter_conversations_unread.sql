-- Extend the blocked-user filter (already on get_messages_page) to the
-- conversation list and the unread counters. Without this, a blocked user's
-- message still shows in the conversation preview, still increments the
-- per-conversation unread badge, and still counts toward the home chat-icon
-- total — so blocking only hid the messages inside an open thread.
--
-- One-way semantics, identical to get_messages_page: hide messages authored
-- by a team whose owning user the caller (auth.uid()) has blocked.

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
    -- Skip messages from teams the caller has blocked
    AND NOT EXISTS (
      SELECT 1
      FROM teams t2
      JOIN user_blocks ub ON ub.blocked_id = t2.user_id
      WHERE t2.id = msg.team_id
        AND ub.blocker_id = (SELECT auth.uid())
    )
    -- Auth: verify caller owns this team
    AND EXISTS (
      SELECT 1 FROM teams t_auth
      WHERE t_auth.id = p_team_id
        AND t_auth.user_id = (SELECT auth.uid())
    );
$function$;
