-- ────────────────────────────────────────────────────────────────────────────
-- Security hardening phase 2: SECURITY DEFINER function access + storage
--
-- Problem: All 33+ SECURITY DEFINER functions were callable by the `anon`
-- role. Several (batch_update_*, execute_trade_transfers, notify_*)
-- have NO internal auth checks and can be exploited by anyone with the
-- public anon key — no login required.
--
-- Fix:
--   1. Revoke ALL SECURITY DEFINER functions from `anon`.
--   2. Revoke server-only functions (cron, edge-function, trigger) from
--      `authenticated` too — they should only run via service_role.
--   3. Tighten storage bucket limits (file size, MIME types).
--   4. Remove overly-permissive storage object policies for team-logos
--      (uploads/deletes now exclusively via edge function + service_role).
-- ────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
-- 1. Revoke every SECURITY DEFINER function from `anon`
--    Even functions with internal auth.uid() checks get revoked as
--    defense-in-depth — anon should never call authenticated RPCs.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.add_team_to_league_chat() FROM anon;
REVOKE EXECUTE ON FUNCTION public.batch_update_matchup_scores(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.batch_update_team_standings(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_bidding_wars(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_imported_team(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_league_chat() FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_trade_transfers(uuid, uuid, uuid, timestamptz, date, date, jsonb, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_conversations(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_draft_room_init(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_league_roster_stats(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_matchup_init(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_messages_page(uuid, timestamptz, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_trade_conversation(uuid, uuid, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_poll_results(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_survey_results(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_total_unread(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_week_score_data(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_team_count(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_team_stats(uuid, integer, integer, integer, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_league_commissioner(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_league_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_team_present(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_trade_participant(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.leak_trade_rumor(uuid, uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_team_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_chat_message() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_moderate_message() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_trade_proposed() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ping_draft_presence(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_player_season_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_autopick(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.toggle_trade_block_interest(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transfer_team_ownership(uuid, uuid, text) FROM anon;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. Revoke server-only functions from `authenticated` too
--    These are called exclusively from cron jobs, triggers, or edge
--    functions using the service_role key. No user should invoke them.
-- ════════════════════════════════════════════════════════════════════════════

-- Cron / edge-function batch operations (NO internal auth checks)
REVOKE EXECUTE ON FUNCTION public.batch_update_matchup_scores(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.batch_update_team_standings(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_trade_transfers(uuid, uuid, uuid, timestamptz, date, date, jsonb, jsonb, jsonb, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_team_count(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_team_stats(uuid, integer, integer, integer, numeric, numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_week_score_data(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_player_season_stats() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM authenticated;

-- Trigger / webhook notification functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_chat_message() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_moderate_message() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_trade_proposed() FROM authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. Tighten storage bucket limits
-- ════════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets
SET file_size_limit    = 2097152,  -- 2 MB
    allowed_mime_types = '{image/jpeg,image/png,image/webp}'
WHERE id = 'team-logos';

UPDATE storage.buckets
SET file_size_limit    = 5242880,  -- 5 MB
    allowed_mime_types = '{image/jpeg,image/png,image/webp,image/gif}'
WHERE id = 'chat-media';


-- ════════════════════════════════════════════════════════════════════════════
-- 4. Remove overly-permissive storage object policies for team-logos
--    Current policies only check auth.uid() IS NOT NULL, meaning ANY
--    authenticated user can upload/overwrite/delete ANY team's logo.
--    Uploads and deletes are already gated by the upload-team-logo edge
--    function (which checks team ownership), so direct policies are removed.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Team owners can upload their logo" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can update their logo" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can delete their logo" ON storage.objects;
