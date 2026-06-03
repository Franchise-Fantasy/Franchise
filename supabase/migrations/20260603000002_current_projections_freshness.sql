-- Add a freshness window to current_player_projections.
--
-- Original view returned DISTINCT ON (player_id, sport, horizon) ordered by
-- projection_date DESC, with NO season or recency filter. Because the engine
-- writes one NEW dated row per run (projection_date = run date) rather than
-- overwriting, the "latest" row could be arbitrarily old: if the daily job
-- stops (season ends / CI breaks) the view keeps serving the last run
-- indefinitely, and a player with only prior-SEASON rows would surface that
-- stale prior-season line as "current" — with no staleness signal to the app.
--
-- Fix: only consider rows from the last 14 days. The engine runs daily while
-- in phase, so a live player always has a fresh row; once a run stops, stale
-- rows age out and the surface goes quiet (honest "no current projection")
-- instead of silently showing months-old data. This also fixes the cross-
-- season leak, since prior-season rows carry old dates. Column set is
-- unchanged, so generated types are unaffected.

CREATE OR REPLACE VIEW current_player_projections
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (player_id, sport, horizon)
  *
FROM player_projections
WHERE projection_date >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY player_id, sport, horizon, projection_date DESC;

GRANT SELECT ON current_player_projections TO authenticated;
