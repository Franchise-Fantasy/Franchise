-- Drop indexes that pg_stat_user_indexes shows as never-used.
-- Keeping idx_user_sub_rc_customer + idx_league_sub_rc_customer (RevenueCat
-- webhook lookup paths — just haven't fired in this observation window).

DROP INDEX IF EXISTS public.idx_chat_conv_trade;
DROP INDEX IF EXISTS public.idx_chat_reactions_conversation;
DROP INDEX IF EXISTS public.idx_phs_player;
DROP INDEX IF EXISTS public.idx_phs_season;
DROP INDEX IF EXISTS public.idx_watchlist_player_id;
DROP INDEX IF EXISTS public.idx_survey_answers_response;
DROP INDEX IF EXISTS public.idx_activity_tokens_draft;
