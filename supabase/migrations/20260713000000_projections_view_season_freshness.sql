-- Scope the 14-day freshness window to the `next_game` horizon only.
--
-- 20260603000002 added `projection_date >= CURRENT_DATE - INTERVAL '14 days'` so
-- a STOPPED engine ages out of the view instead of serving stale numbers. That is
-- correct for `next_game`: it is rewritten daily and a week-old game-by-game line
-- is simply wrong.
--
-- It is WRONG for `season`. That row is a deliberately frozen preseason baseline
-- ("what we expected before a ball was bounced") — season_project ignores
-- current-season games by design, so it is written once per season and then never
-- refreshed. Once the season tips off, resolve_phase.py points the daily snapshot
-- job at the NEXT season (see 20260605000000), so the current season's row stops
-- being rewritten and silently aged out of the view 14 days later. The freshness
-- window is a liveness check, and it was being applied to a horizon that is
-- static on purpose.
--
-- Live effect (WNBA 2026): the season snapshot was last written 2026-06-04, so
-- from ~2026-06-18 the view returned ZERO season rows for 2026 while 171 sat in
-- the base table. Every consumer pinning `.eq('season', <current>)` went blank —
-- PlayerDetailModal's "PROJ" lens, the analytics "Performance vs Expected" card,
-- and autodraft's season-projection ranking fallback (which then silently fell
-- through to last season's flat average for every player).
--
-- Fix: `season` rows are always visible; every other horizon keeps the liveness
-- guard (written as an allowlist so a future horizon is guarded by default). The
-- DISTINCT ON already keeps exactly one row per (player, sport, horizon, season),
-- so an older season's row can never shadow the current one — consumers pin the
-- season they want. Column set unchanged → generated types unaffected.

CREATE OR REPLACE VIEW current_player_projections
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (player_id, sport, horizon, season)
  *
FROM player_projections
WHERE horizon = 'season'
   OR projection_date >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY player_id, sport, horizon, season, projection_date DESC;

GRANT SELECT ON current_player_projections TO authenticated;
