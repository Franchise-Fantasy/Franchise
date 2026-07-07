-- Security review 2026-07-07 — HIGH: chat_members broken access control.
--
-- The chat_members INSERT policy only checked is_league_member(conversation's
-- league), NOT that the inserted team was the caller's own or a legitimate
-- participant. Combined with the equally-permissive SELECT policy (any member
-- could enumerate every conversation + its members), a league member could add
-- their own team to any DM / trade conversation in the league and read (and
-- post) the private messages. All membership creation is SECURITY DEFINER
-- (get_or_create_trade_conversation, post_trade_update, the add_team_to_league_chat
-- trigger, and the new get_or_create_dm), so direct client INSERT is not needed.

-- 1. SD RPC for creating/fetching a DM (replaces the direct client inserts in
--    hooks/chat/useCreateDM). Enforces that the caller owns "my" team and that
--    both teams belong to the league.
CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_league_id uuid, p_my_team_id uuid, p_other_team_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = p_my_team_id AND user_id = (SELECT auth.uid()) AND league_id = p_league_id
  ) THEN
    RAISE EXCEPTION 'Not your team';
  END IF;

  IF p_other_team_id = p_my_team_id
     OR NOT EXISTS (SELECT 1 FROM teams WHERE id = p_other_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'Invalid recipient';
  END IF;

  SELECT cm1.conversation_id INTO v_conv_id
  FROM chat_members cm1
  JOIN chat_members cm2 ON cm2.conversation_id = cm1.conversation_id
  JOIN chat_conversations cc ON cc.id = cm1.conversation_id
  WHERE cm1.team_id = p_my_team_id
    AND cm2.team_id = p_other_team_id
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
  VALUES (v_conv_id, p_my_team_id), (v_conv_id, p_other_team_id);

  RETURN v_conv_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_dm(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid, uuid, uuid) TO authenticated;

-- 2. Remove the permissive direct-INSERT path. Membership is now created only by
--    SECURITY DEFINER functions/triggers, which bypass RLS.
DROP POLICY IF EXISTS "League members can add chat members" ON public.chat_members;

-- 3. Members may only see the membership of conversations they belong to
--    (previously any league member could enumerate every conversation's members).
DROP POLICY IF EXISTS "League members can view chat members" ON public.chat_members;
CREATE POLICY "Members can view members of their conversations" ON public.chat_members
  FOR SELECT TO authenticated
  USING (is_conversation_member(conversation_id));
