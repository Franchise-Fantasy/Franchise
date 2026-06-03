-- Player projections produced by the external Bayesian projections engine
-- (wnba-engine, run from GitHub Actions). Stores the RAW projected per-game
-- stat line + posterior uncertainty per player/sport/season/horizon/date.
--
-- Fantasy points are intentionally NOT stored here: they are league-specific
-- (driven by league_scoring_settings) and computed client-side from this raw
-- line, exactly like season-stat fpts are today. See utils/scoring/fantasyPoints.ts.
--
-- Two horizons are populated:
--   'season' — pre-season / draft snapshot (recency-weighted prior seasons +
--              experience curve + games-played model; re-run through the
--              offseason so it absorbs injuries/trades)
--   'ros'    — in-season rest-of-season Bayesian projection, refreshed daily
-- ('next_game' is reserved for a future Vegas-props-blended horizon.)

CREATE TABLE player_projections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sport           text NOT NULL,
  season          text NOT NULL,
  horizon         text NOT NULL CHECK (horizon IN ('season', 'ros', 'next_game')),
  projection_date date NOT NULL,

  -- Projected per-game means (posterior expected value)
  proj_min        numeric(5,1) DEFAULT 0,
  proj_pts        numeric(5,1) DEFAULT 0,
  proj_reb        numeric(5,1) DEFAULT 0,
  proj_ast        numeric(5,1) DEFAULT 0,
  proj_stl        numeric(5,1) DEFAULT 0,
  proj_blk        numeric(5,1) DEFAULT 0,
  proj_tov        numeric(5,1) DEFAULT 0,
  proj_3pm        numeric(5,1) DEFAULT 0,
  proj_3pa        numeric(5,1) DEFAULT 0,
  proj_fgm        numeric(5,1) DEFAULT 0,
  proj_fga        numeric(5,1) DEFAULT 0,
  proj_ftm        numeric(5,1) DEFAULT 0,
  proj_fta        numeric(5,1) DEFAULT 0,
  proj_fg_pct     numeric(4,3),
  proj_ft_pct     numeric(4,3),

  -- Posterior standard deviations (Bayesian uncertainty — drives the
  -- "Performance vs Expected" band in analytics)
  sd_pts          numeric(5,1),
  sd_reb          numeric(5,1),
  sd_ast          numeric(5,1),
  sd_fantasy_pg   numeric(5,1),

  -- Games-played horizon
  games_remaining int,
  projected_games int,

  model_version   text NOT NULL,
  source          text NOT NULL DEFAULT 'wnba-engine',
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (player_id, sport, season, horizon, projection_date)
);

CREATE INDEX idx_player_projections_lookup
  ON player_projections (sport, season, horizon, projection_date);
CREATE INDEX idx_player_projections_player
  ON player_projections (player_id);

-- Latest projection per (player, sport, horizon) so the app reads one row per
-- player without juggling projection_date. security_invoker so the base
-- table's RLS applies to the querying user.
CREATE VIEW current_player_projections
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (player_id, sport, horizon)
  *
FROM player_projections
ORDER BY player_id, sport, horizon, projection_date DESC;

-- RLS: public reference data, same posture as player_historical_stats /
-- player_season_stats. Authenticated users read all rows; writes happen only
-- via the direct Postgres connection used by the engine (bypasses RLS), so
-- there are intentionally no INSERT/UPDATE/DELETE policies.
ALTER TABLE player_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read projections"
  ON player_projections FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY "Authenticated users can read projections"
  ON public.player_projections IS
  'Intentional: public player projections, not league-scoped, not sensitive. See 20260415_document_public_player_data_rls.sql.';

GRANT SELECT ON current_player_projections TO authenticated;
