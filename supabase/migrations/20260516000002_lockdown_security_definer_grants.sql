-- Lock down SECURITY DEFINER function EXECUTE grants per the Supabase security
-- linter's `anon_security_definer_function_executable` + `authenticated_*`
-- recommendations. Every function below was created with the default
-- `EXECUTE TO PUBLIC` grant, which means anon and authenticated could call
-- them through PostgREST. The functions all do their own auth internally
-- (so anon callers hit an auth check + bail), but defense-in-depth says
-- drop the executable grant entirely where it isn't needed.
--
-- Three categories:
--   A. Triggers / cron internals — no GRANT needed (trigger owner / service_role
--      runs them). REVOKE from PUBLIC.
--   B. Service-role only (called by edge functions) — REVOKE from PUBLIC,
--      explicit GRANT to service_role for documentation.
--   C. User-callable RPCs + RLS helpers — REVOKE from PUBLIC, GRANT to
--      authenticated. anon stays revoked.
--
-- A follow-up block at the bottom handles functions whose original CREATE
-- included explicit `GRANT TO anon, authenticated` (those weren't covered
-- by REVOKE FROM PUBLIC).

-- ── Category A: trigger / cron internals ────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.add_team_to_league_chat() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_blocked_content() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_league_chat() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cron_watchdog() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_league_creation_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_team_ownership_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_chat_message() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_moderate_message() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_trade_proposed() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_player_season_stats() FROM PUBLIC;

-- ── Category B: service-role only (called by edge functions) ────────────────
REVOKE EXECUTE ON FUNCTION public.batch_update_matchup_scores(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.batch_update_team_standings(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_bidding_wars(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_trade_transfers(uuid, uuid, uuid, timestamp with time zone, date, date, jsonb, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_vault_secret(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_week_score_data(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_team_count(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_team_stats(uuid, integer, integer, integer, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pgmq_archive(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pgmq_read(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pgmq_send(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_cron_heartbeat(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pro_archive_franchise_history(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pro_archive_team_rotation(integer, text, numeric, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.batch_update_matchup_scores(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.batch_update_team_standings(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_bidding_wars(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_draft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_trade_transfers(uuid, uuid, uuid, timestamp with time zone, date, date, jsonb, jsonb, jsonb, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vault_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_week_score_data(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_team_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_team_stats(uuid, integer, integer, integer, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_archive(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_read(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_send(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_cron_heartbeat(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pro_archive_franchise_history(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pro_archive_team_rotation(integer, text, numeric, integer) TO service_role;

-- ── Category C: user-callable RPCs + RLS helpers ────────────────────────────
-- Revoked from PUBLIC + anon, kept on authenticated. Each function still does
-- its own auth check internally (auth.uid() vs row owner, league membership,
-- commissioner gate, etc.) — the lint can't see those checks so the
-- authenticated_security_definer_function_executable warning stays as a
-- documented exception.
REVOKE EXECUTE ON FUNCTION public.accept_trade_proposal(uuid, uuid, uuid[], text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_message(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_imported_team(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_conversations(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_draft_room_init(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_league_roster_stats(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_matchup_init(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_messages_page(uuid, timestamp with time zone, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_trade_conversation(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_poll_results(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_survey_results(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_total_unread(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_trade_proposals_for_league(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_league_commissioner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_league_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_team_blocked_by_me(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_team_present(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_trade_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leak_trade_rumor(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_team_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ping_draft_presence(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.post_trade_update(uuid, uuid, uuid[], text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_autopick(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.toggle_trade_block_interest(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_team_ownership(uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_trade_proposal(uuid, uuid, uuid[], text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_imported_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversations(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_draft_room_init(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_league_roster_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matchup_init(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_messages_page(uuid, timestamp with time zone, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_trade_conversation(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_poll_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_survey_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_total_unread(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trade_proposals_for_league(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_commissioner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_blocked_by_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_present(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trade_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leak_trade_rumor(uuid, uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_team_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ping_draft_presence(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_trade_update(uuid, uuid, uuid[], text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_autopick(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_trade_block_interest(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(uuid, uuid, text) TO authenticated;
