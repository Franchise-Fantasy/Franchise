-- Adds WNBA league support by introducing a `sport` discriminator on every
-- table that ingests external sports data, renames a few NBA-specific column
-- names to sport-neutral ones, and rebuilds the player_season_stats matview +
-- the RPCs that explicitly listed the renamed columns.
--
-- Single-path strategy (per plan):
--   - one set of tables, one set of edge functions
--   - sport ∈ {'nba','wnba'} as a column, defaulting to 'nba' for back-compat
--   - composite uniques (sport, external_id_*) so BDL's separate WNBA ID
--     namespace can't collide with NBA
--
-- Rename map:
--   leagues             — add sport
--   players             — add sport, nba_team→pro_team, nba_draft_year→draft_year
--   player_historical_stats — add sport, nba_team→pro_team
--   live_player_stats   — add sport
--   player_games        — add sport
--   player_news         — add sport
--   nba_schedule        — rename to game_schedule, add sport
--
-- Dependencies handled in this migration:
--   - drop dependent RPCs (get_team_roster_stats, get_league_roster_stats,
--     get_team_roster_for_trade, get_draft_queue) before dropping the matview
--   - drop & recreate player_season_stats matview
--   - recreate RPCs with the renamed columns + sport

BEGIN;

-- ── 0. Drop dependent RPCs first ─────────────────────────────────────────────
-- get_team_roster_stats RETURNS SETOF player_season_stats, which would block
-- DROP MATERIALIZED VIEW. The other three TABLE(…) RPCs explicitly list
-- nba_team / nba_draft_year / external_id_nba and need to be rebuilt anyway.

DROP FUNCTION IF EXISTS public.get_team_roster_stats(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_league_roster_stats(uuid);
DROP FUNCTION IF EXISTS public.get_team_roster_for_trade(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_draft_queue(uuid, uuid, uuid);

-- ── 1. leagues: sport column ────────────────────────────────────────────────
ALTER TABLE public.leagues
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

CREATE INDEX idx_leagues_sport ON public.leagues(sport);

-- Sport is immutable post-creation. Trigger blocks UPDATEs that change it.
CREATE OR REPLACE FUNCTION public.leagues_sport_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.sport IS DISTINCT FROM OLD.sport THEN
    RAISE EXCEPTION 'leagues.sport is immutable (was %, attempted %)', OLD.sport, NEW.sport;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leagues_sport_immutable
  BEFORE UPDATE OF sport ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.leagues_sport_immutable();

-- ── 2. players: sport + column renames + composite uniques ──────────────────
DROP MATERIALIZED VIEW IF EXISTS public.player_season_stats;

ALTER TABLE public.players
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

-- Drop global unique constraints that won't survive multi-sport. BDL's WNBA
-- player IDs are in a separate namespace from NBA, so a (sport, id) composite
-- is the right uniqueness model. The plain b-tree index on external_id_bdl
-- (idx_players_external_id_bdl) is kept for fast lookups; the unique
-- constraints become composites below.
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_external_id_bdl_key;
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_external_id_nba_unique;

-- Rename NBA-named columns to sport-neutral.
ALTER TABLE public.players RENAME COLUMN nba_team TO pro_team;
ALTER TABLE public.players RENAME COLUMN nba_draft_year TO draft_year;

-- Recreate index on the renamed column (drop old name first).
DROP INDEX IF EXISTS public.players_nba_team_idx;
CREATE INDEX players_pro_team_idx ON public.players(pro_team);

-- Composite uniques. NULLs are allowed multiple times in Postgres uniques by
-- default, so prospects (which don't have BDL IDs) and WNBA players (which
-- don't have NBA Stats IDs) coexist cleanly.
ALTER TABLE public.players
  ADD CONSTRAINT players_sport_external_id_bdl_key UNIQUE (sport, external_id_bdl);

ALTER TABLE public.players
  ADD CONSTRAINT players_sport_external_id_nba_key UNIQUE (sport, external_id_nba);

-- Helpful covering index for the most common player-pool query
-- ("active rostered players for sport X").
CREATE INDEX idx_players_sport_status ON public.players(sport, status);

-- ── 3. player_historical_stats: sport + nba_team rename ─────────────────────
ALTER TABLE public.player_historical_stats
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

ALTER TABLE public.player_historical_stats RENAME COLUMN nba_team TO pro_team;

-- ── 4. live_player_stats: sport ──────────────────────────────────────────────
ALTER TABLE public.live_player_stats
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

CREATE INDEX live_player_stats_sport_date_idx
  ON public.live_player_stats(sport, game_date);

-- ── 5. player_games: sport ──────────────────────────────────────────────────
ALTER TABLE public.player_games
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

CREATE INDEX player_games_sport_date_idx
  ON public.player_games(sport, game_date);

-- ── 6. player_news: sport ───────────────────────────────────────────────────
ALTER TABLE public.player_news
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

CREATE INDEX player_news_sport_published_idx
  ON public.player_news(sport, published_at DESC);

-- ── 7. nba_schedule → game_schedule: rename + sport ─────────────────────────
ALTER TABLE public.nba_schedule RENAME TO game_schedule;

ALTER TABLE public.game_schedule
  ADD COLUMN sport text NOT NULL DEFAULT 'nba'
  CHECK (sport IN ('nba','wnba'));

-- BDL's WNBA game IDs are in a separate namespace from NBA — drop the global
-- unique on game_id and replace with composite (sport, game_id).
ALTER TABLE public.game_schedule DROP CONSTRAINT IF EXISTS nba_schedule_game_id_key;
ALTER TABLE public.game_schedule
  ADD CONSTRAINT game_schedule_sport_game_id_key UNIQUE (sport, game_id);

-- Rename indexes for clarity (no functional change).
ALTER INDEX IF EXISTS public.nba_schedule_pkey         RENAME TO game_schedule_pkey;
ALTER INDEX IF EXISTS public.nba_schedule_date_idx     RENAME TO game_schedule_date_idx;
ALTER INDEX IF EXISTS public.nba_schedule_home_team_idx RENAME TO game_schedule_home_team_idx;
ALTER INDEX IF EXISTS public.nba_schedule_away_team_idx RENAME TO game_schedule_away_team_idx;
ALTER INDEX IF EXISTS public.nba_schedule_season_idx   RENAME TO game_schedule_season_idx;

CREATE INDEX game_schedule_sport_date_idx
  ON public.game_schedule(sport, game_date);

-- ── 8. Recreate player_season_stats matview ─────────────────────────────────
-- Same shape as before, plus sport (from players) and the renamed columns
-- (pro_team, draft_year). Group-by adds the new/renamed columns.

CREATE MATERIALIZED VIEW public.player_season_stats AS
SELECT
  p.id AS player_id,
  p.name,
  p."position",
  p.sport,
  p.pro_team,
  p.status,
  p.external_id_nba,
  p.rookie,
  p.season_added,
  p.draft_year,
  p.birthdate,
  (count(pg.id) FILTER (WHERE pg.min > 0))::integer AS games_played,
  (COALESCE(sum(pg.pts) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_pts,
  (COALESCE(sum(pg.reb) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_reb,
  (COALESCE(sum(pg.ast) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_ast,
  (COALESCE(sum(pg.stl) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_stl,
  (COALESCE(sum(pg.blk) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_blk,
  (COALESCE(sum(pg.tov) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_tov,
  (COALESCE(sum(pg.fgm) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_fgm,
  (COALESCE(sum(pg.fga) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_fga,
  (COALESCE(sum(pg."3pm") FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_3pm,
  (COALESCE(sum(pg."3pa") FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_3pa,
  (COALESCE(sum(pg.ftm) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_ftm,
  (COALESCE(sum(pg.fta) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_fta,
  (COALESCE(sum(pg.pf)  FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_pf,
  (COALESCE(sum(CASE WHEN pg.double_double THEN 1 ELSE 0 END) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_dd,
  (COALESCE(sum(CASE WHEN pg.triple_double THEN 1 ELSE 0 END) FILTER (WHERE pg.min > 0), 0::bigint))::integer AS total_td,
  round(avg(pg.pts)   FILTER (WHERE pg.min > 0), 1) AS avg_pts,
  round(avg(pg.reb)   FILTER (WHERE pg.min > 0), 1) AS avg_reb,
  round(avg(pg.ast)   FILTER (WHERE pg.min > 0), 1) AS avg_ast,
  round(avg(pg.stl)   FILTER (WHERE pg.min > 0), 1) AS avg_stl,
  round(avg(pg.blk)   FILTER (WHERE pg.min > 0), 1) AS avg_blk,
  round(avg(pg.tov)   FILTER (WHERE pg.min > 0), 1) AS avg_tov,
  round(avg(pg.fgm)   FILTER (WHERE pg.min > 0), 1) AS avg_fgm,
  round(avg(pg.fga)   FILTER (WHERE pg.min > 0), 1) AS avg_fga,
  round(avg(pg."3pm") FILTER (WHERE pg.min > 0), 1) AS avg_3pm,
  round(avg(pg."3pa") FILTER (WHERE pg.min > 0), 1) AS avg_3pa,
  round(avg(pg.ftm)   FILTER (WHERE pg.min > 0), 1) AS avg_ftm,
  round(avg(pg.fta)   FILTER (WHERE pg.min > 0), 1) AS avg_fta,
  round(avg(pg.pf)    FILTER (WHERE pg.min > 0), 1) AS avg_pf,
  round(avg(pg.min)   FILTER (WHERE pg.min > 0), 1) AS avg_min
FROM public.players p
LEFT JOIN public.player_games pg ON pg.player_id = p.id
GROUP BY
  p.id, p.name, p."position", p.sport, p.pro_team, p.status,
  p.external_id_nba, p.rookie, p.season_added, p.draft_year, p.birthdate;

-- Unique index lets `REFRESH MATERIALIZED VIEW CONCURRENTLY` work.
CREATE UNIQUE INDEX player_season_stats_player_id_idx
  ON public.player_season_stats(player_id);

CREATE INDEX player_season_stats_sport_idx
  ON public.player_season_stats(sport);

-- ── 9. Recreate RPCs with renamed columns + sport ───────────────────────────

CREATE OR REPLACE FUNCTION public.get_team_roster_stats(p_league_id uuid, p_team_id uuid)
RETURNS SETOF public.player_season_stats
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_league_roster_stats(p_league_id uuid)
RETURNS TABLE (
  team_id uuid,
  player_id uuid,
  name text,
  "position" text,
  sport text,
  pro_team text,
  status text,
  external_id_nba text,
  rookie boolean,
  season_added text,
  draft_year integer,
  birthdate date,
  games_played integer,
  total_pts integer, total_reb integer, total_ast integer,
  total_stl integer, total_blk integer, total_tov integer,
  total_fgm integer, total_fga integer, total_3pm integer,
  total_3pa integer, total_ftm integer, total_fta integer,
  total_pf integer, total_dd integer, total_td integer,
  avg_pts numeric, avg_reb numeric, avg_ast numeric,
  avg_stl numeric, avg_blk numeric, avg_tov numeric,
  avg_fgm numeric, avg_fga numeric, avg_3pm numeric,
  avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT lp.team_id, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_league_roster_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_team_roster_for_trade(p_league_id uuid, p_team_id uuid)
RETURNS TABLE (
  roster_slot text,
  player_id uuid,
  name text,
  "position" text,
  sport text,
  pro_team text,
  status text,
  external_id_nba text,
  rookie boolean,
  season_added text,
  draft_year integer,
  birthdate date,
  games_played integer,
  total_pts integer, total_reb integer, total_ast integer,
  total_stl integer, total_blk integer, total_tov integer,
  total_fgm integer, total_fga integer, total_3pm integer,
  total_3pa integer, total_ftm integer, total_fta integer,
  total_pf integer, total_dd integer, total_td integer,
  avg_pts numeric, avg_reb numeric, avg_ast numeric,
  avg_stl numeric, avg_blk numeric, avg_tov numeric,
  avg_fgm numeric, avg_fga numeric, avg_3pm numeric,
  avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT lp.roster_slot, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_draft_queue(
  p_draft_id uuid,
  p_team_id uuid,
  p_league_id uuid
)
RETURNS TABLE (
  queue_id uuid,
  player_id uuid,
  priority integer,
  name text,
  "position" text,
  sport text,
  pro_team text,
  status text,
  external_id_nba text,
  rookie boolean,
  season_added text,
  draft_year integer,
  birthdate date,
  games_played integer,
  total_pts integer, total_reb integer, total_ast integer,
  total_stl integer, total_blk integer, total_tov integer,
  total_fgm integer, total_fga integer, total_3pm integer,
  total_3pa integer, total_ftm integer, total_fta integer,
  total_pf integer, total_dd integer, total_td integer,
  avg_pts numeric, avg_reb numeric, avg_ast numeric,
  avg_stl numeric, avg_blk numeric, avg_tov numeric,
  avg_fgm numeric, avg_fga numeric, avg_3pm numeric,
  avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT dq.id AS queue_id, pss.player_id, dq.priority,
    pss.name, pss."position", pss.sport, pss.pro_team, pss.status,
    pss.external_id_nba, pss.rookie, pss.season_added,
    pss.draft_year, pss.birthdate, pss.games_played,
    pss.total_pts, pss.total_reb, pss.total_ast,
    pss.total_stl, pss.total_blk, pss.total_tov,
    pss.total_fgm, pss.total_fga, pss.total_3pm,
    pss.total_3pa, pss.total_ftm, pss.total_fta,
    pss.total_pf, pss.total_dd, pss.total_td,
    pss.avg_pts, pss.avg_reb, pss.avg_ast,
    pss.avg_stl, pss.avg_blk, pss.avg_tov,
    pss.avg_fgm, pss.avg_fga, pss.avg_3pm,
    pss.avg_3pa, pss.avg_ftm, pss.avg_fta,
    pss.avg_pf, pss.avg_min
  FROM draft_queue dq
  JOIN player_season_stats pss ON pss.player_id = dq.player_id
  WHERE dq.draft_id = p_draft_id
    AND dq.team_id = p_team_id
    AND dq.player_id NOT IN (
      SELECT lp.player_id FROM league_players lp WHERE lp.league_id = p_league_id
    )
  ORDER BY dq.priority;
$$;

GRANT EXECUTE ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) TO authenticated;

COMMIT;
