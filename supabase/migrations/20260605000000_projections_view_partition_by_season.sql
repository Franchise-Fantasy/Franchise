-- Partition current_player_projections by `season` as well as
-- (player_id, sport, horizon).
--
-- The view collapsed to ONE row per (player_id, sport, horizon) by newest
-- projection_date. But the `season` horizon carries TWO rows per player during
-- the live season: the current-season snapshot AND a forward-looking next-season
-- row (the offseason job — projections/resolve_phase.py — projects the next
-- unopened season). That next-season row is refreshed daily, so its
-- projection_date is newer and it SHADOWED the current-season row: the view
-- surfaced next-season for ~73% of players (e.g. WNBA 2026 → only 46 of 171),
-- and every consumer filtering `.eq('season', <current>)` then dropped them
-- entirely — the "PROJ" lens vanished from PlayerDetailModal and autodraft's
-- season-projection draft-ranking fallback went blind for those players.
--
-- The 14-day freshness window (20260603000002) did NOT catch this: both rows
-- are fresh, so the newer (next-season) one wins. Its comment assumed
-- "prior-season rows carry old dates" — true for past seasons, but next-season
-- rows carry NEWER dates, the opposite direction.
--
-- Adding `season` to the partition keeps the latest row PER season, so each
-- consumer's season filter resolves to the right row. Column set unchanged →
-- generated types unaffected.

CREATE OR REPLACE VIEW current_player_projections
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (player_id, sport, horizon, season)
  *
FROM player_projections
WHERE projection_date >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY player_id, sport, horizon, season, projection_date DESC;

GRANT SELECT ON current_player_projections TO authenticated;
