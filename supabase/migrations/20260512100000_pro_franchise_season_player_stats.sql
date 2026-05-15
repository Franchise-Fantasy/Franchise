-- Regular-season per-player stats for the NBA Playoff Archive.
-- One row per (season, franchise, player). Sourced from Basketball-Reference
-- team pages (e.g. /teams/DET/2026.html) — both the basic per_game_stats
-- table and the advanced table on the same page contribute columns here.
--
-- We surface this on the ArchiveTeamSheet ("Regular Season Rotation"
-- section), filtered to mpg >= 15 and sorted by VORP descending.

CREATE TABLE IF NOT EXISTS pro_franchise_season_player_stats (
  season int NOT NULL,
  franchise_id text NOT NULL REFERENCES pro_franchise(id),
  bbref_player_id text NOT NULL,
  player_name text NOT NULL,

  -- Basic per-game
  gp int,
  mpg numeric(4, 1),
  pts_per numeric(4, 1),
  reb_per numeric(4, 1),
  ast_per numeric(4, 1),
  stl_per numeric(4, 1),
  blk_per numeric(4, 1),

  -- Shooting + advanced
  fg_pct numeric(4, 3),
  tp_pct numeric(4, 3),
  ts_pct numeric(4, 3),
  vorp numeric(4, 1),

  PRIMARY KEY (season, franchise_id, bbref_player_id)
);

CREATE INDEX IF NOT EXISTS idx_pfsps_season_franchise
  ON pro_franchise_season_player_stats (season, franchise_id);

ALTER TABLE pro_franchise_season_player_stats ENABLE ROW LEVEL SECURITY;

-- Same pattern as pro_season_award: authenticated read, service-role writes.
DROP POLICY IF EXISTS pfsps_select ON pro_franchise_season_player_stats;
CREATE POLICY pfsps_select ON pro_franchise_season_player_stats
  FOR SELECT TO authenticated USING (true);

-- Surface in the team-run RPC alongside playoff path + awards. Returns
-- only rotation regulars (mpg >= 15), sorted by VORP descending. Falls
-- through to ordering by mpg when VORP is null (early-season runs).
CREATE OR REPLACE FUNCTION pro_archive_team_rotation(
  p_season int,
  p_franchise_id text,
  p_min_mpg numeric DEFAULT 15.0,
  p_min_games int DEFAULT 25
)
RETURNS TABLE (
  bbref_player_id text,
  player_name text,
  gp int,
  mpg numeric,
  pts_per numeric,
  reb_per numeric,
  ast_per numeric,
  stl_per numeric,
  blk_per numeric,
  fg_pct numeric,
  tp_pct numeric,
  ts_pct numeric,
  vorp numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.bbref_player_id,
    p.player_name,
    p.gp,
    p.mpg,
    p.pts_per,
    p.reb_per,
    p.ast_per,
    p.stl_per,
    p.blk_per,
    p.fg_pct,
    p.tp_pct,
    p.ts_pct,
    p.vorp
  FROM pro_franchise_season_player_stats p
  WHERE p.season = p_season
    AND p.franchise_id = p_franchise_id
    AND COALESCE(p.mpg, 0) >= p_min_mpg
    AND COALESCE(p.gp, 0) >= p_min_games
  ORDER BY p.vorp DESC NULLS LAST, p.mpg DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION pro_archive_team_rotation(int, text, numeric, int) TO authenticated;
