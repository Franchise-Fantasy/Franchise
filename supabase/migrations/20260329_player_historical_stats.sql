-- Stores season-by-season historical stats per player.
-- Populated by the backfill script (backend/backfill_historical_stats.py)
-- and snapshotted at the end of each NBA season.

CREATE TABLE player_historical_stats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season       text NOT NULL,
  games_played int NOT NULL DEFAULT 0,
  avg_min      numeric(5,1) DEFAULT 0,
  avg_pts      numeric(5,1) DEFAULT 0,
  avg_reb      numeric(5,1) DEFAULT 0,
  avg_ast      numeric(5,1) DEFAULT 0,
  avg_stl      numeric(5,1) DEFAULT 0,
  avg_blk      numeric(5,1) DEFAULT 0,
  avg_tov      numeric(5,1) DEFAULT 0,
  avg_fgm      numeric(5,1) DEFAULT 0,
  avg_fga      numeric(5,1) DEFAULT 0,
  avg_3pm      numeric(5,1) DEFAULT 0,
  avg_3pa      numeric(5,1) DEFAULT 0,
  avg_ftm      numeric(5,1) DEFAULT 0,
  avg_fta      numeric(5,1) DEFAULT 0,
  avg_pf       numeric(5,1) DEFAULT 0,
  total_pts    int DEFAULT 0,
  total_reb    int DEFAULT 0,
  total_ast    int DEFAULT 0,
  total_stl    int DEFAULT 0,
  total_blk    int DEFAULT 0,
  total_tov    int DEFAULT 0,
  total_dd     int DEFAULT 0,
  total_td     int DEFAULT 0,
  nba_team     text,
  UNIQUE (player_id, season)
);

CREATE INDEX idx_phs_player ON player_historical_stats(player_id);
CREATE INDEX idx_phs_season ON player_historical_stats(season);

ALTER TABLE player_historical_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read historical stats"
  ON player_historical_stats FOR SELECT
  TO authenticated
  USING (true);
