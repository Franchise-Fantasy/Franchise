-- Document that the permissive "USING (true)" RLS policies on
-- player_historical_stats, player_news, and player_news_mentions are
-- intentional: these tables contain public NFL/NBA player data (stats,
-- news mentions) that is not league-scoped, not user-generated, and not
-- sensitive. All authenticated users should be able to read all rows.
--
-- Writes are restricted to service_role (edge functions only) because there
-- are no INSERT/UPDATE/DELETE policies — authenticated users cannot modify.
--
-- If a future audit flags these as "overly permissive," it is a false
-- positive. Do not tighten without a product reason.

COMMENT ON POLICY "Authenticated users can read historical stats"
  ON public.player_historical_stats IS
  'Intentional: public player stats, not league-scoped, not sensitive. See 20260415_document_public_player_data_rls.sql.';

COMMENT ON POLICY "Authenticated users can read news"
  ON public.player_news IS
  'Intentional: public player news, not league-scoped, not sensitive. See 20260415_document_public_player_data_rls.sql.';

COMMENT ON POLICY "Authenticated users can read news mentions"
  ON public.player_news_mentions IS
  'Intentional: public news-to-player join, not league-scoped, not sensitive. See 20260415_document_public_player_data_rls.sql.';
