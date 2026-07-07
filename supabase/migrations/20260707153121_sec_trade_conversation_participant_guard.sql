-- Security review 2026-07-07 — Batch 2: trade-conversation participation guard.
--
-- get_or_create_trade_conversation / post_trade_update previously only checked
-- that the caller was a *league member*, not a *participant of the trade*. Since
-- the 3+-team branch inserts caller-supplied p_team_ids into an existing trade
-- conversation, any league member could add their own team to another team's
-- private trade chat and read the negotiation. Require the caller to be a
-- participant of the proposal (proposer or a listed team) or the commissioner.
-- (auth.uid() IS NULL keeps any future service-role/backend caller working.)

CREATE OR REPLACE FUNCTION public.get_or_create_trade_conversation(p_league_id uuid, p_proposal_id uuid, p_team_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_root_id uuid;
  v_current_id uuid;
  v_counter_of uuid;
  v_conv_id uuid;
  v_tid uuid;
BEGIN
  -- Auth: caller must be a participant of this trade (proposer or a listed team)
  -- or the league commissioner. Service-role callers (auth.uid() NULL) are trusted.
  IF NOT (
    (SELECT auth.uid()) IS NULL
    OR is_league_commissioner(p_league_id)
    OR EXISTS (SELECT 1 FROM trade_proposals tp JOIN teams t ON t.id = tp.proposed_by_team_id
               WHERE tp.id = p_proposal_id AND t.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM trade_proposal_teams tpt JOIN teams t ON t.id = tpt.team_id
               WHERE tpt.proposal_id = p_proposal_id AND t.user_id = (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not a participant of this trade';
  END IF;

  -- 2-team trades: use the DM between the two teams
  IF array_length(p_team_ids, 1) = 2 THEN
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

    INSERT INTO chat_conversations (league_id, type)
    VALUES (p_league_id, 'dm')
    RETURNING id INTO v_conv_id;

    INSERT INTO chat_members (conversation_id, team_id)
    VALUES (v_conv_id, p_team_ids[1]), (v_conv_id, p_team_ids[2]);

    RETURN v_conv_id;
  END IF;

  -- 3+ team trades: use a trade-scoped group conversation
  v_current_id := p_proposal_id;
  FOR i IN 1..20 LOOP
    SELECT counteroffer_of INTO v_counter_of
    FROM trade_proposals WHERE id = v_current_id;
    IF v_counter_of IS NULL THEN EXIT; END IF;
    v_current_id := v_counter_of;
  END LOOP;
  v_root_id := v_current_id;

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
    FOREACH v_tid IN ARRAY p_team_ids LOOP
      INSERT INTO chat_members (conversation_id, team_id)
      VALUES (v_conv_id, v_tid)
      ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN v_conv_id;
  END IF;

  INSERT INTO chat_conversations (league_id, type, trade_proposal_id)
  VALUES (p_league_id, 'trade', v_root_id)
  RETURNING id INTO v_conv_id;

  FOREACH v_tid IN ARRAY p_team_ids LOOP
    INSERT INTO chat_members (conversation_id, team_id)
    VALUES (v_conv_id, v_tid);
  END LOOP;

  RETURN v_conv_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_trade_update(p_league_id uuid, p_proposal_id uuid, p_team_ids uuid[], p_event text, p_team_name text DEFAULT NULL::text, p_acting_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv_id uuid;
  v_content text;
BEGIN
  -- Auth: same participant/commissioner check as get_or_create_trade_conversation.
  IF NOT (
    (SELECT auth.uid()) IS NULL
    OR is_league_commissioner(p_league_id)
    OR EXISTS (SELECT 1 FROM trade_proposals tp JOIN teams t ON t.id = tp.proposed_by_team_id
               WHERE tp.id = p_proposal_id AND t.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM trade_proposal_teams tpt JOIN teams t ON t.id = tpt.team_id
               WHERE tpt.proposal_id = p_proposal_id AND t.user_id = (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not a participant of this trade';
  END IF;

  v_conv_id := get_or_create_trade_conversation(p_league_id, p_proposal_id, p_team_ids);

  v_content := json_build_object(
    'event', p_event,
    'team_name', p_team_name,
    'proposal_id', p_proposal_id
  )::text;

  INSERT INTO chat_messages (conversation_id, team_id, content, type, league_id)
  VALUES (v_conv_id, p_acting_team_id, v_content, 'trade_update', p_league_id);

  RETURN v_conv_id;
END;
$function$;
