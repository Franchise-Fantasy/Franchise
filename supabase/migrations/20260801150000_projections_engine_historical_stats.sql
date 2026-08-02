-- Let projections_engine read player_historical_stats.
--
-- franchise-v1.3's season horizon backfills seasons the game logs don't retain
-- from player_historical_stats (fetch_historical_season_rates in
-- projections/franchise_db.py) — for NBA that's what restores 2024-25 as a
-- second prior. The least-privilege role from 20260603000001 was scoped to the
-- five tables the engine used at the time, so the nightly Action died with
-- `permission denied for table player_historical_stats` on the first run after
-- v1.3 shipped.
--
-- RLS is enabled on the table and its only SELECT policy is TO authenticated,
-- so — as with every other table this role reads — the GRANT alone is not
-- enough; it needs a policy scoped TO projections_engine. Read-only: the engine
-- never writes historical stats (that's archive_season_player_stats /
-- backfill_historical_stats.py, both service-role).
--
-- Rule of thumb for future model versions: adding a new source table to the
-- engine means a GRANT *and* a policy in the same commit as the Python change.
GRANT SELECT ON public.player_historical_stats TO projections_engine;

DROP POLICY IF EXISTS "projections_engine reads historical stats" ON public.player_historical_stats;
CREATE POLICY "projections_engine reads historical stats"
  ON public.player_historical_stats FOR SELECT TO projections_engine USING (true);
