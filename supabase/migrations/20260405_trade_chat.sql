-- ============================================================================
-- Trade Negotiation Chat
-- ============================================================================
-- Adds trade-scoped group conversations that are auto-created when a trade is
-- proposed, supporting N members (handles multi-team trades). Counteroffers
-- reuse the same thread by walking the counteroffer_of chain.
-- ============================================================================

-- 1. Add 'trade' to the allowed conversation types + add trade_proposal_id
ALTER TABLE chat_conversations DROP CONSTRAINT chat_conversations_type_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_type_check
  CHECK (type = ANY (ARRAY['league'::text, 'dm'::text, 'trade'::text]));

ALTER TABLE chat_conversations
  ADD COLUMN trade_proposal_id uuid REFERENCES trade_proposals(id);

CREATE INDEX idx_chat_conv_trade
  ON chat_conversations(trade_proposal_id)
  WHERE trade_proposal_id IS NOT NULL;

-- 2. RPC: get_or_create_trade_conversation
--    For 2-team trades: finds/creates the DM between the two teams.
--    For 3+ team trades: walks the counteroffer chain to find a root proposal,
--    then finds or creates a trade-scoped group conversation.
CREATE OR REPLACE FUNCTION public.get_or_create_trade_conversation(
  p_league_id uuid,
  p_proposal_id uuid,
  p_team_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_root_id uuid;
  v_current_id uuid;
  v_counter_of uuid;
  v_conv_id uuid;
  v_tid uuid;
BEGIN
  -- Auth: verify caller is a member of this league
  IF NOT EXISTS (
    SELECT 1 FROM teams
    WHERE league_id = p_league_id AND user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  -- ── 2-team trades: use the DM between the two teams ──
  IF array_length(p_team_ids, 1) = 2 THEN
    -- Look for an existing DM between these two teams in this league
    SELECT cm1.conversation_id INTO v_conv_id
    FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.conversation_id = cm1.conversation_id
    JOIN chat_conversations cc ON cc.id = cm1.conversation_id
    WHERE cm1.team_id = p_team_ids[1]
      AND cm2.team_id = p_team_ids[2]
      AND cc.league_id = p_league_id
      AND cc.type = 'dm'
    LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
      RETURN v_conv_id;
    END IF;

    -- Create a new DM
    INSERT INTO chat_conversations (league_id, type)
    VALUES (p_league_id, 'dm')
    RETURNING id INTO v_conv_id;

    INSERT INTO chat_members (conversation_id, team_id)
    VALUES (v_conv_id, p_team_ids[1]), (v_conv_id, p_team_ids[2]);

    RETURN v_conv_id;
  END IF;

  -- ── 3+ team trades: use a trade-scoped group conversation ──

  -- Walk up the counteroffer chain to find the root proposal
  v_current_id := p_proposal_id;
  FOR i IN 1..20 LOOP
    SELECT counteroffer_of INTO v_counter_of
    FROM trade_proposals WHERE id = v_current_id;
    IF v_counter_of IS NULL THEN EXIT; END IF;
    v_current_id := v_counter_of;
  END LOOP;
  v_root_id := v_current_id;

  -- Look for an existing trade conversation linked to any proposal in the chain
  WITH RECURSIVE chain AS (
    SELECT id FROM trade_proposals WHERE id = v_root_id
    UNION ALL
    SELECT tp.id FROM trade_proposals tp
    JOIN chain c ON tp.counteroffer_of = c.id
  )
  SELECT cc.id INTO v_conv_id
  FROM chat_conversations cc
  WHERE cc.trade_proposal_id IN (SELECT id FROM chain)
    AND cc.type = 'trade'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    -- Add any new team members (e.g. counteroffer adds a team)
    FOREACH v_tid IN ARRAY p_team_ids LOOP
      INSERT INTO chat_members (conversation_id, team_id)
      VALUES (v_conv_id, v_tid)
      ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN v_conv_id;
  END IF;

  -- Create new trade conversation linked to the root proposal
  INSERT INTO chat_conversations (league_id, type, trade_proposal_id)
  VALUES (p_league_id, 'trade', v_root_id)
  RETURNING id INTO v_conv_id;

  FOREACH v_tid IN ARRAY p_team_ids LOOP
    INSERT INTO chat_members (conversation_id, team_id)
    VALUES (v_conv_id, v_tid);
  END LOOP;

  RETURN v_conv_id;
END;
$$;

-- 3. Combined RPC: get-or-create trade conversation + post a trade_update message.
--    SECURITY DEFINER bypasses RLS so system messages (team_id=null) can be inserted.
CREATE OR REPLACE FUNCTION public.post_trade_update(
  p_league_id uuid,
  p_proposal_id uuid,
  p_team_ids uuid[],
  p_event text,
  p_team_name text DEFAULT NULL,
  p_acting_team_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv_id uuid;
  v_content text;
BEGIN
  -- Auth: verify caller is a member of this league
  IF NOT EXISTS (
    SELECT 1 FROM teams
    WHERE league_id = p_league_id AND user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  -- Reuse existing RPC to find/create the conversation
  v_conv_id := get_or_create_trade_conversation(p_league_id, p_proposal_id, p_team_ids);

  -- Build the trade_update JSON content
  v_content := json_build_object(
    'event', p_event,
    'team_name', p_team_name,
    'proposal_id', p_proposal_id
  )::text;

  -- Insert the system message (bypasses RLS via SECURITY DEFINER)
  INSERT INTO chat_messages (conversation_id, team_id, content, type, league_id)
  VALUES (v_conv_id, p_acting_team_id, v_content, 'trade_update', p_league_id);

  RETURN v_conv_id;
END;
$$;

-- 4. Update get_conversations to handle trade conversations
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
    ORDER BY msg.conversation_id, msg.created_at DESC
  ),
  unread_counts AS (
    SELECT msg.conversation_id, COUNT(*) AS cnt
    FROM chat_messages msg
    JOIN my_memberships mm ON mm.conversation_id = msg.conversation_id
    WHERE msg.team_id IS DISTINCT FROM p_team_id
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
$$;

-- 5. Update chat_messages INSERT policy to allow system messages (team_id IS NULL)
--    from users who are members of the conversation (needed for trade_update messages).
DROP POLICY "Members can send messages" ON chat_messages;

CREATE POLICY "Members can send messages" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Normal messages: team belongs to user AND is a conversation member
    (
      team_id IS NOT NULL
      AND team_id IN (SELECT id FROM teams WHERE user_id = (SELECT auth.uid()))
      AND EXISTS (
        SELECT 1 FROM chat_members cm
        WHERE cm.conversation_id = chat_messages.conversation_id
          AND cm.team_id = chat_messages.team_id
      )
    )
    OR
    -- System messages (trade_update, etc.): team_id is null, caller owns a team in the conversation
    (
      team_id IS NULL
      AND EXISTS (
        SELECT 1 FROM chat_members cm
        JOIN teams t ON t.id = cm.team_id
        WHERE cm.conversation_id = chat_messages.conversation_id
          AND t.user_id = (SELECT auth.uid())
      )
    )
  );

-- 6. Add 'trade_update' to allowed message types
ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_type_check
  CHECK (type = ANY (ARRAY['text'::text, 'poll'::text, 'trade'::text, 'rumor'::text, 'survey'::text, 'image'::text, 'gif'::text, 'trade_update'::text]));
