-- ============================================================================
-- RLS & RPC Security Hardening
-- ============================================================================
-- Fixes:
--   1. Server-only functions: revoke execute from anon/authenticated
--   2. Client-facing RPCs: add auth checks for team ownership & membership
--   3. Policies: tighten role from {public} to {authenticated}
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. REVOKE execute on server-only functions from anon / authenticated
--    These are only called from edge functions (service_role) or DB triggers.
-- ────────────────────────────────────────────────────────────────────────────

-- Vault secret reader — most critical; leaks decrypted secrets
REVOKE EXECUTE ON FUNCTION public.get_vault_secret(text) FROM anon, authenticated;

-- Rate limiting — only called from edge functions; accepting arbitrary user_id
-- from client would allow DoS of other users' rate limit windows
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM anon, authenticated;

-- Subscription tier lookup — takes arbitrary user_id; only needed server-side
REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid, uuid) FROM anon, authenticated;

-- Week score data bundle — only called from get-week-scores edge function
REVOKE EXECUTE ON FUNCTION public.get_week_score_data(uuid, uuid) FROM anon, authenticated;

-- Stats mutation — only called from finalize-week edge function
REVOKE EXECUTE ON FUNCTION public.increment_team_stats(uuid, integer, integer, integer, numeric, numeric) FROM anon, authenticated;

-- Materialized view refresh — cron/admin only
REVOKE EXECUTE ON FUNCTION public.refresh_player_season_stats() FROM anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2a. get_messages_page — add conversation membership check
--     Without this, anyone who guesses a conversation_id can read messages.
-- ────────────────────────────────────────────────────────────────────────────

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
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- Auth: caller must be a member of this conversation
    AND EXISTS (
      SELECT 1 FROM chat_members cm_auth
      JOIN teams t_auth ON t_auth.id = cm_auth.team_id
      WHERE cm_auth.conversation_id = p_conversation_id
        AND t_auth.user_id = (SELECT auth.uid())
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2b. get_conversations — validate caller owns p_team_id
--     Without this, passing another team's id exposes their conversation list.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_conversations(p_league_id uuid, p_team_id uuid)
RETURNS TABLE(
  id uuid,
  league_id uuid,
  type text,
  created_at timestamp with time zone,
  last_message text,
  last_message_at timestamp with time zone,
  last_message_team_name text,
  unread_count bigint,
  other_team_name text
)
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
        WHEN msg.type = 'poll'   THEN '📊 Poll'
        WHEN msg.type = 'survey' THEN '📋 Survey'
        WHEN msg.type = 'trade'  THEN '🤝 Trade Completed'
        WHEN msg.type = 'rumor'  THEN '👀 Rumor'
        ELSE msg.content
      END AS content,
      msg.created_at,
      CASE
        WHEN msg.type IN ('trade', 'rumor') THEN NULL
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
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2c. get_total_unread — validate caller owns p_team_id
-- ────────────────────────────────────────────────────────────────────────────

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
    -- Auth: verify caller owns this team
    AND EXISTS (
      SELECT 1 FROM teams t_auth
      WHERE t_auth.id = p_team_id
        AND t_auth.user_id = (SELECT auth.uid())
    );
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2d. get_survey_results — add league membership check
--     (get_poll_results already has this; get_survey_results was missing it)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_survey_results(p_survey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb := '[]'::jsonb;
  q record;
  total_responses int;
  q_result jsonb;
  v_league_id uuid;
BEGIN
  -- Auth: verify caller is a member of the survey's league
  SELECT cs.league_id INTO v_league_id
  FROM commissioner_surveys cs
  WHERE cs.id = p_survey_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Survey not found';
  END IF;

  IF NOT is_league_member(v_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  SELECT count(*) INTO total_responses
  FROM survey_responses WHERE survey_id = p_survey_id;

  FOR q IN
    SELECT sq.id, sq.type, sq.options, sq.sort_order, sq.prompt
    FROM survey_questions sq
    WHERE sq.survey_id = p_survey_id
    ORDER BY sq.sort_order
  LOOP
    IF q.type IN ('multiple_choice_single', 'multiple_choice_multi') THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'options', q.options,
        'total_responses', total_responses,
        'option_counts', (
          SELECT coalesce(jsonb_agg(cnt ORDER BY idx), '[]'::jsonb)
          FROM (
            SELECT opt_idx.idx, count(sa.id) AS cnt
            FROM generate_series(0, jsonb_array_length(q.options) - 1) AS opt_idx(idx)
            LEFT JOIN survey_answers sa ON sa.question_id = q.id
              AND sa.value @> to_jsonb(opt_idx.idx)
            GROUP BY opt_idx.idx
          ) sub
        )
      ) INTO q_result;

    ELSIF q.type = 'rating' THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'total_responses', total_responses,
        'distribution', (
          SELECT coalesce(jsonb_object_agg(r::text, coalesce(sub.cnt, 0)), '{}'::jsonb)
          FROM generate_series(1, 5) AS r
          LEFT JOIN (
            SELECT (sa.value)::int AS rating, count(*) AS cnt
            FROM survey_answers sa WHERE sa.question_id = q.id
            GROUP BY (sa.value)::int
          ) sub ON sub.rating = r
        ),
        'average', (
          SELECT coalesce(round(avg((sa.value)::numeric), 2), 0)
          FROM survey_answers sa WHERE sa.question_id = q.id
        )
      ) INTO q_result;

    ELSIF q.type = 'free_text' THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'total_responses', total_responses,
        'responses', (
          SELECT coalesce(jsonb_agg(sa.value #>> '{}'), '[]'::jsonb)
          FROM survey_answers sa WHERE sa.question_id = q.id
        )
      ) INTO q_result;

    ELSIF q.type = 'ranked_choice' THEN
      SELECT jsonb_build_object(
        'question_id', q.id,
        'type', q.type,
        'prompt', q.prompt,
        'options', q.options,
        'total_responses', total_responses,
        'borda_scores', (
          SELECT coalesce(jsonb_agg(score ORDER BY idx), '[]'::jsonb)
          FROM (
            SELECT opt_idx.idx,
              coalesce(sum(
                jsonb_array_length(q.options) - 1 -
                (SELECT pos FROM generate_series(0, jsonb_array_length(sa.value) - 1) AS pos
                 WHERE (sa.value -> pos)::int = opt_idx.idx LIMIT 1)
              ), 0) AS score
            FROM generate_series(0, jsonb_array_length(q.options) - 1) AS opt_idx(idx)
            LEFT JOIN survey_answers sa ON sa.question_id = q.id
            GROUP BY opt_idx.idx
          ) sub
        )
      ) INTO q_result;
    END IF;

    result := result || q_result;
  END LOOP;

  RETURN result;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2e. leak_trade_rumor — verify caller owns p_team_id
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leak_trade_rumor(
  p_league_id uuid, p_team_id uuid, p_player_id uuid,
  p_proposal_id uuid, p_template text, p_player_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_root_id uuid;
  v_current_id uuid;
  v_counter_of uuid;
  v_conv_id uuid;
BEGIN
  -- Auth: verify caller owns this team
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND user_id = (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Not your team';
  END IF;

  -- Walk up counteroffer chain to find root proposal
  v_current_id := p_proposal_id;
  FOR i IN 1..20 LOOP
    SELECT counteroffer_of INTO v_counter_of
    FROM trade_proposals WHERE id = v_current_id;
    IF v_counter_of IS NULL THEN EXIT; END IF;
    v_current_id := v_counter_of;
  END LOOP;
  v_root_id := v_current_id;

  -- Insert dedup record (unique constraint will raise if already leaked)
  INSERT INTO trade_rumors (league_id, player_id, trigger_type, proposal_id, template)
  VALUES (p_league_id, p_player_id, 'manual', v_root_id, p_template);

  -- Find league chat
  SELECT id INTO v_conv_id
  FROM chat_conversations
  WHERE league_id = p_league_id AND type = 'league'
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    RAISE EXCEPTION 'League chat not found';
  END IF;

  -- Post rumor message
  INSERT INTO chat_messages (conversation_id, team_id, content, type, league_id)
  VALUES (
    v_conv_id,
    p_team_id,
    json_build_object('player_name', p_player_name, 'template', p_template)::text,
    'rumor',
    p_league_id
  );
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2f. toggle_trade_block_interest — verify caller owns p_team_id
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.toggle_trade_block_interest(
  p_league_id uuid, p_player_id uuid, p_team_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current uuid[];
  v_interested boolean;
  v_new_len int;
  v_auto_rumors boolean;
  v_existing int;
  v_player_name text;
  v_conv_id uuid;
  v_template text := '{player} is attracting attention on the trade block — multiple teams have expressed interest';
BEGIN
  -- Auth: verify caller owns this team
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND user_id = (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Not your team';
  END IF;

  SELECT trade_block_interest INTO v_current
  FROM league_players
  WHERE league_id = p_league_id AND player_id = p_player_id AND on_trade_block = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_interested := p_team_id = ANY(v_current);

  IF v_interested THEN
    UPDATE league_players
    SET trade_block_interest = array_remove(trade_block_interest, p_team_id)
    WHERE league_id = p_league_id AND player_id = p_player_id;
  ELSE
    UPDATE league_players
    SET trade_block_interest = array_append(trade_block_interest, p_team_id)
    WHERE league_id = p_league_id AND player_id = p_player_id;

    -- Check if we just crossed the 2-team threshold for an auto rumor
    v_new_len := coalesce(array_length(v_current, 1), 0) + 1;

    IF v_new_len >= 2 THEN
      SELECT auto_rumors_enabled INTO v_auto_rumors
      FROM leagues
      WHERE id = p_league_id;

      IF v_auto_rumors THEN
        -- Only create one rumor per player per league for this trigger type
        SELECT count(*) INTO v_existing
        FROM trade_rumors
        WHERE league_id = p_league_id
          AND player_id = p_player_id
          AND trigger_type = 'auto_block_interest';

        IF v_existing = 0 THEN
          SELECT name INTO v_player_name
          FROM players
          WHERE id = p_player_id;

          INSERT INTO trade_rumors (league_id, player_id, trigger_type, template)
          VALUES (p_league_id, p_player_id, 'auto_block_interest', v_template);

          -- Post rumor to the league chat
          SELECT id INTO v_conv_id
          FROM chat_conversations
          WHERE league_id = p_league_id AND type = 'league'
          LIMIT 1;

          IF v_conv_id IS NOT NULL THEN
            INSERT INTO chat_messages (conversation_id, team_id, content, type, league_id)
            VALUES (
              v_conv_id,
              null,
              json_build_object(
                'player_name', coalesce(v_player_name, 'Unknown'),
                'template', v_template
              )::text,
              'rumor',
              p_league_id
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NOT v_interested;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2g. ping_draft_presence — verify caller owns p_team_id
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ping_draft_presence(
  p_draft_id uuid, p_team_id uuid, p_reset_autopick boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Auth: verify caller owns this team
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND user_id = (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Not your team';
  END IF;

  INSERT INTO draft_team_status (draft_id, team_id, autopick_on, last_seen_at)
  VALUES (p_draft_id, p_team_id, false, now())
  ON CONFLICT (draft_id, team_id) DO UPDATE SET
    last_seen_at = now(),
    autopick_on = CASE WHEN p_reset_autopick THEN false ELSE draft_team_status.autopick_on END;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2h. set_autopick — verify caller owns p_team_id
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_autopick(
  p_draft_id uuid, p_team_id uuid, p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Auth: verify caller owns this team
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND user_id = (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Not your team';
  END IF;

  INSERT INTO draft_team_status (draft_id, team_id, autopick_on, last_seen_at)
  VALUES (p_draft_id, p_team_id, p_enabled, now())
  ON CONFLICT (draft_id, team_id) DO UPDATE SET
    autopick_on = p_enabled,
    last_seen_at = now();
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Tighten RLS policies from {public} to {authenticated}
--    All these policies already use auth.uid() in their clauses, so anon gets
--    nothing today. This adds an explicit role gate as defense-in-depth.
-- ────────────────────────────────────────────────────────────────────────────

-- chat_conversations
ALTER POLICY "League members can view conversations" ON chat_conversations TO authenticated;
ALTER POLICY "League members can create conversations" ON chat_conversations TO authenticated;

-- chat_members
ALTER POLICY "Members can update own read receipt" ON chat_members TO authenticated;
ALTER POLICY "League members can add chat members" ON chat_members TO authenticated;
ALTER POLICY "League members can view chat members" ON chat_members TO authenticated;

-- chat_messages
ALTER POLICY "Conversation members can read messages" ON chat_messages TO authenticated;
ALTER POLICY "Members can send messages" ON chat_messages TO authenticated;

-- chat_reactions
ALTER POLICY "Conversation members can read reactions" ON chat_reactions TO authenticated;
ALTER POLICY "Members can remove own reactions" ON chat_reactions TO authenticated;
ALTER POLICY "Members can add reactions" ON chat_reactions TO authenticated;

-- commissioner_announcements
ALTER POLICY "Commissioner can create announcements" ON commissioner_announcements TO authenticated;
ALTER POLICY "Commissioner can delete announcements" ON commissioner_announcements TO authenticated;
ALTER POLICY "Members can view announcements" ON commissioner_announcements TO authenticated;

-- commissioner_polls
ALTER POLICY "Commissioner can create polls" ON commissioner_polls TO authenticated;
ALTER POLICY "Commissioner can update polls" ON commissioner_polls TO authenticated;
ALTER POLICY "League members can view polls" ON commissioner_polls TO authenticated;

-- commissioner_surveys
ALTER POLICY "League members can read surveys" ON commissioner_surveys TO authenticated;

-- draft_picks
ALTER POLICY "draft_picks_update" ON draft_picks TO authenticated;

-- draft_queue
ALTER POLICY "Users can manage their own queue" ON draft_queue TO authenticated;

-- draft_team_status
ALTER POLICY "Team owners manage own draft status" ON draft_team_status TO authenticated;
ALTER POLICY "League members can read draft team status" ON draft_team_status TO authenticated;

-- drafts
ALTER POLICY "drafts_select" ON drafts TO authenticated;

-- keeper_declarations
ALTER POLICY "Team owners can delete own keeper declarations" ON keeper_declarations TO authenticated;
ALTER POLICY "Team owners can insert own keeper declarations" ON keeper_declarations TO authenticated;
ALTER POLICY "League members can read keeper declarations" ON keeper_declarations TO authenticated;

-- league_notification_prefs
ALTER POLICY "Users can manage their own league notification prefs" ON league_notification_prefs TO authenticated;

-- league_payments
ALTER POLICY "Commissioner can manage payments" ON league_payments TO authenticated;

-- league_subscriptions
ALTER POLICY "League members can read league subscription" ON league_subscriptions TO authenticated;

-- league_waivers
ALTER POLICY "League members can view league waivers" ON league_waivers TO authenticated;
ALTER POLICY "League members can insert league waivers" ON league_waivers TO authenticated;

-- lottery_results
ALTER POLICY "Commissioner can insert lottery results" ON lottery_results TO authenticated;
ALTER POLICY "League members can view lottery results" ON lottery_results TO authenticated;

-- pick_swaps
ALTER POLICY "League members can view pick swaps" ON pick_swaps TO authenticated;

-- playoff_bracket
ALTER POLICY "League members can read bracket" ON playoff_bracket TO authenticated;

-- playoff_seed_picks
ALTER POLICY "League members can read seed picks" ON playoff_seed_picks TO authenticated;
ALTER POLICY "Team owner can update their pick" ON playoff_seed_picks TO authenticated;

-- poll_votes
ALTER POLICY "League members can vote" ON poll_votes TO authenticated;
ALTER POLICY "poll_votes_select" ON poll_votes TO authenticated;

-- profiles
ALTER POLICY "Users can manage own profile" ON profiles TO authenticated;

-- push_tokens
ALTER POLICY "Users can manage own token" ON push_tokens TO authenticated;

-- survey_answers
ALTER POLICY "Members can read own survey answers" ON survey_answers TO authenticated;

-- survey_questions
ALTER POLICY "League members can read survey questions" ON survey_questions TO authenticated;

-- survey_responses
ALTER POLICY "Members can read own survey responses" ON survey_responses TO authenticated;
ALTER POLICY "Commissioner can read all survey responses" ON survey_responses TO authenticated;

-- team_seasons
ALTER POLICY "League members can view team seasons" ON team_seasons TO authenticated;

-- trade_proposals
ALTER POLICY "trade_proposals_select" ON trade_proposals TO authenticated;

-- trade_rumors
ALTER POLICY "trade_rumors_insert" ON trade_rumors TO authenticated;
ALTER POLICY "trade_rumors_select" ON trade_rumors TO authenticated;

-- user_subscriptions
ALTER POLICY "Users can read own subscription" ON user_subscriptions TO authenticated;

-- waiver_claims
ALTER POLICY "League members can update own claims" ON waiver_claims TO authenticated;
ALTER POLICY "League members can view waiver claims" ON waiver_claims TO authenticated;
ALTER POLICY "League members can insert own claims" ON waiver_claims TO authenticated;

-- waiver_priority
ALTER POLICY "League members can insert waiver priority" ON waiver_priority TO authenticated;
ALTER POLICY "League members can view waiver priority" ON waiver_priority TO authenticated;

-- watchlist
ALTER POLICY "Users manage own watchlist" ON watchlist TO authenticated;
