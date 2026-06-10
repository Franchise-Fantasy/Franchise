-- Membership-change push notifications.
--
-- The leave / remove / reassign RPCs previously mutated team ownership silently —
-- no one was told. This wires each to fire a push via the existing webhook-notify
-- edge function (the same pg_net + Vault-secret path the trade/chat triggers use):
--   - leave_league          -> notify the COMMISSIONER (a slot is now unclaimed)
--   - remove_member         -> notify the REMOVED member (you lost access)
--   - reassign_commissioner -> notify the NEW commissioner (you have control)
--
-- Server-authoritative (only these SECURITY DEFINER functions can fire it, so it
-- can't be spoofed by a client) and fire-and-forget (pg_net queues the POST after
-- commit), mirroring notify_trade_proposed / notify_chat_message.

-- ---------------------------------------------------------------------------
-- 1. Internal helper: POST a membership_change event to webhook-notify.
--    Not client-callable — only the SD RPCs below PERFORM it (running as owner).
--    Reuses get_vault_secret('project_url') / ('webhook_secret') from the
--    20260317 webhook-trigger migration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_membership_change(
  p_event text,
  p_league_id uuid,
  p_team_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'vault', 'net', 'extensions'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := get_vault_secret('project_url') || '/functions/v1/webhook-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', get_vault_secret('webhook_secret')
    ),
    body := jsonb_build_object(
      'type', 'membership_change',
      'event', p_event,
      'league_id', p_league_id,
      'team_id', p_team_id,
      'target_user_id', p_target_user_id
    ),
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  -- Notification is best-effort: a Vault/pg_net hiccup must never roll back the
  -- membership change that called us. Swallow and warn.
  RAISE WARNING 'notify_membership_change(%) failed: %', p_event, SQLERRM;
END $function$;

REVOKE ALL ON FUNCTION public.notify_membership_change(text, uuid, uuid, uuid) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. leave_league — unchanged logic, + notify the commissioner on success.
--    (Body copied from 20260608003000; only the PERFORM notify line is new.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_league(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_created_by uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_team_id
  FROM teams
  WHERE league_id = p_league_id AND user_id = v_user_id;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_a_member');
  END IF;

  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;
  IF v_created_by = v_user_id THEN
    RETURN jsonb_build_object('error', 'commissioner_must_reassign');
  END IF;

  IF EXISTS (SELECT 1 FROM drafts WHERE league_id = p_league_id AND status = 'in_progress') THEN
    RETURN jsonb_build_object('error', 'draft_in_progress');
  END IF;

  PERFORM vacate_team_internal(p_league_id, v_team_id, v_user_id);

  -- Tell the commissioner their roster has an unclaimed team to reassign.
  PERFORM notify_membership_change('left', p_league_id, v_team_id, NULL);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. remove_member — unchanged logic, + notify the removed member on success.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_member(p_league_id uuid, p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_created_by uuid;
  v_target_user uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;
  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('error', 'league_not_found');
  END IF;
  IF v_created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can remove a member';
  END IF;

  SELECT user_id INTO v_target_user FROM teams WHERE id = p_team_id AND league_id = p_league_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'team_not_found');
  END IF;
  IF v_target_user IS NULL THEN
    RETURN jsonb_build_object('error', 'already_unclaimed');
  END IF;
  IF v_target_user = v_user_id THEN
    RETURN jsonb_build_object('error', 'cannot_remove_self');
  END IF;

  IF EXISTS (SELECT 1 FROM drafts WHERE league_id = p_league_id AND status = 'in_progress') THEN
    RETURN jsonb_build_object('error', 'draft_in_progress');
  END IF;

  PERFORM vacate_team_internal(p_league_id, p_team_id, v_target_user);

  -- Tell the booted member they lost access (addressed by user_id — the team is
  -- now vacated, so a team-based push would resolve to nobody).
  PERFORM notify_membership_change('removed', p_league_id, p_team_id, v_target_user);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. reassign_commissioner — unchanged logic, + notify the new commissioner.
--    (Body copied from 20260608002000; only the PERFORM notify line is new.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_commissioner(p_league_id uuid, p_new_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_created_by uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM leagues WHERE id = p_league_id;

  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('error', 'league_not_found');
  END IF;
  IF v_created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can reassign the commissioner role';
  END IF;
  IF p_new_user_id = v_user_id THEN
    RETURN jsonb_build_object('error', 'already_commissioner');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM teams WHERE league_id = p_league_id AND user_id = p_new_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'target_not_member');
  END IF;

  UPDATE leagues
  SET created_by = p_new_user_id, commissioner = p_new_user_id
  WHERE id = p_league_id;

  UPDATE teams
  SET is_commissioner = (user_id IS NOT DISTINCT FROM p_new_user_id)
  WHERE league_id = p_league_id;

  -- Tell the new commissioner they now hold the gavel.
  PERFORM notify_membership_change('commissioner_assigned', p_league_id, NULL, p_new_user_id);

  RETURN jsonb_build_object('ok', true);
END;
$function$;
