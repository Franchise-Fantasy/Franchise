-- pg_partman is the standard Postgres partition manager. Installing now (no
-- table conversion) so it's ready when chat_messages / live_player_stats /
-- player_games grow large enough to need monthly/seasonal partitioning.
--
-- When that day comes:
--   1. SELECT partman.create_parent('public.chat_messages', 'created_at',
--        'native', 'monthly');
--   2. Configure retention via partman.part_config (e.g., 24 months).
--   3. Add a pg_cron job to run partman.run_maintenance() nightly.
--
-- Doing nothing here that affects current data — just provisioning the extension.

CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
