-- NFL as a third sport — schema phase (Phase 1 of the NFL internal test).
-- Modeled on 20260425000041_add_sport_wnba_support.sql.
--
-- 1. Widen the 7 sport CHECK constraints to include 'nfl'.
-- 2. Sparse NFL stat columns on player_games + live_player_stats (nullable —
--    NULL on basketball rows; basketball columns keep their defaults on NFL
--    rows). NFL stat rows are written with min = 1 as a "played" sentinel so
--    the matview's FILTER (WHERE min > 0) counts games without changes.
-- 3. NFL total_* columns on player_historical_stats (season totals only —
--    averages are derived on read; fg_long is a max, not a sum, so it stays
--    game-level only).
-- 4. game_schedule.week (NFL week number; NULL for basketball. BDL restarts
--    week numbering in the postseason, so fantasy ingest stores
--    postseason=false games only).
-- 5. Rebuild player_season_stats with NFL totals+avgs APPENDED (column order
--    is load-bearing: get_league_roster_stats / get_team_roster_for_trade
--    expand pss.* against an explicit RETURNS TABLE list).
-- 6. Recreate the 4 dependent RPCs. get_team_roster_stats returns
--    SETOF player_season_stats so it inherits the new columns; the other
--    three get the NFL columns appended to their lists.
--
-- Ownership/grants are restated explicitly because this migration is applied
-- via `supabase db query` (login role), not as postgres.

-- ── 1. CHECK constraints ─────────────────────────────────────────────────────

ALTER TABLE public.leagues DROP CONSTRAINT leagues_sport_check;
ALTER TABLE public.leagues ADD CONSTRAINT leagues_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

ALTER TABLE public.players DROP CONSTRAINT players_sport_check;
ALTER TABLE public.players ADD CONSTRAINT players_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

ALTER TABLE public.player_historical_stats DROP CONSTRAINT player_historical_stats_sport_check;
ALTER TABLE public.player_historical_stats ADD CONSTRAINT player_historical_stats_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

ALTER TABLE public.live_player_stats DROP CONSTRAINT live_player_stats_sport_check;
ALTER TABLE public.live_player_stats ADD CONSTRAINT live_player_stats_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

ALTER TABLE public.player_games DROP CONSTRAINT player_games_sport_check;
ALTER TABLE public.player_games ADD CONSTRAINT player_games_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

ALTER TABLE public.player_news DROP CONSTRAINT player_news_sport_check;
ALTER TABLE public.player_news ADD CONSTRAINT player_news_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

ALTER TABLE public.game_schedule DROP CONSTRAINT game_schedule_sport_check;
ALTER TABLE public.game_schedule ADD CONSTRAINT game_schedule_sport_check CHECK (sport IN ('nba', 'wnba', 'nfl'));

-- ── 2. NFL stat columns: player_games + live_player_stats ───────────────────
-- dst_pa_pts is the DERIVED points-allowed tier result (0→10, 1-6→7, 7-13→4,
-- 14-20→1, 21-27→0, 28-34→-1, 35+→-4), computed at ingest by poll-live-stats
-- so league scoring stays a flat stat×weight sum. dst_pts_allowed is the raw
-- value for display.

ALTER TABLE public.player_games
  ADD COLUMN pass_att integer,
  ADD COLUMN pass_cmp integer,
  ADD COLUMN pass_yd integer,
  ADD COLUMN pass_td integer,
  ADD COLUMN pass_int integer,
  ADD COLUMN rush_att integer,
  ADD COLUMN rush_yd integer,
  ADD COLUMN rush_td integer,
  ADD COLUMN rec integer,
  ADD COLUMN targets integer,
  ADD COLUMN rec_yd integer,
  ADD COLUMN rec_td integer,
  ADD COLUMN fum_lost integer,
  ADD COLUMN two_pt integer,
  ADD COLUMN ret_td integer,
  ADD COLUMN fg_made integer,
  ADD COLUMN fg_att integer,
  ADD COLUMN fg_long integer,
  ADD COLUMN xp_made integer,
  ADD COLUMN xp_att integer,
  ADD COLUMN dst_sacks integer,
  ADD COLUMN dst_int integer,
  ADD COLUMN dst_fum_rec integer,
  ADD COLUMN dst_td integer,
  ADD COLUMN dst_safety integer,
  ADD COLUMN dst_pts_allowed integer,
  ADD COLUMN dst_pa_pts integer;

ALTER TABLE public.live_player_stats
  ADD COLUMN pass_att integer,
  ADD COLUMN pass_cmp integer,
  ADD COLUMN pass_yd integer,
  ADD COLUMN pass_td integer,
  ADD COLUMN pass_int integer,
  ADD COLUMN rush_att integer,
  ADD COLUMN rush_yd integer,
  ADD COLUMN rush_td integer,
  ADD COLUMN rec integer,
  ADD COLUMN targets integer,
  ADD COLUMN rec_yd integer,
  ADD COLUMN rec_td integer,
  ADD COLUMN fum_lost integer,
  ADD COLUMN two_pt integer,
  ADD COLUMN ret_td integer,
  ADD COLUMN fg_made integer,
  ADD COLUMN fg_att integer,
  ADD COLUMN fg_long integer,
  ADD COLUMN xp_made integer,
  ADD COLUMN xp_att integer,
  ADD COLUMN dst_sacks integer,
  ADD COLUMN dst_int integer,
  ADD COLUMN dst_fum_rec integer,
  ADD COLUMN dst_td integer,
  ADD COLUMN dst_safety integer,
  ADD COLUMN dst_pts_allowed integer,
  ADD COLUMN dst_pa_pts integer;

-- ── 3. NFL season totals on player_historical_stats ─────────────────────────

ALTER TABLE public.player_historical_stats
  ADD COLUMN total_pass_att integer,
  ADD COLUMN total_pass_cmp integer,
  ADD COLUMN total_pass_yd integer,
  ADD COLUMN total_pass_td integer,
  ADD COLUMN total_pass_int integer,
  ADD COLUMN total_rush_att integer,
  ADD COLUMN total_rush_yd integer,
  ADD COLUMN total_rush_td integer,
  ADD COLUMN total_rec integer,
  ADD COLUMN total_targets integer,
  ADD COLUMN total_rec_yd integer,
  ADD COLUMN total_rec_td integer,
  ADD COLUMN total_fum_lost integer,
  ADD COLUMN total_two_pt integer,
  ADD COLUMN total_ret_td integer,
  ADD COLUMN total_fg_made integer,
  ADD COLUMN total_fg_att integer,
  ADD COLUMN total_xp_made integer,
  ADD COLUMN total_xp_att integer,
  ADD COLUMN total_dst_sacks integer,
  ADD COLUMN total_dst_int integer,
  ADD COLUMN total_dst_fum_rec integer,
  ADD COLUMN total_dst_td integer,
  ADD COLUMN total_dst_safety integer,
  ADD COLUMN total_dst_pts_allowed integer,
  ADD COLUMN total_dst_pa_pts integer;

-- ── 4. game_schedule.week ────────────────────────────────────────────────────

ALTER TABLE public.game_schedule ADD COLUMN week integer;

-- ── 5. Rebuild player_season_stats (NFL columns APPENDED — order matters) ────

DROP FUNCTION IF EXISTS public.get_league_roster_stats(uuid);
DROP FUNCTION IF EXISTS public.get_team_roster_for_trade(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_draft_queue(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_team_roster_stats(uuid, uuid);
DROP MATERIALIZED VIEW IF EXISTS public.player_season_stats;

CREATE MATERIALIZED VIEW public.player_season_stats AS
WITH season_floor AS (
  SELECT cur.sport,
         COALESCE(max(prev.end_date), '1900-01-01'::date) AS floor_date
  FROM season_config cur
  LEFT JOIN season_config prev
    ON prev.sport = cur.sport AND prev.end_date < cur.start_date
  WHERE cur.is_current = true
  GROUP BY cur.sport
)
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
  (COALESCE(sum(pg.pts) FILTER (WHERE pg.min > 0), 0))::integer AS total_pts,
  (COALESCE(sum(pg.reb) FILTER (WHERE pg.min > 0), 0))::integer AS total_reb,
  (COALESCE(sum(pg.ast) FILTER (WHERE pg.min > 0), 0))::integer AS total_ast,
  (COALESCE(sum(pg.stl) FILTER (WHERE pg.min > 0), 0))::integer AS total_stl,
  (COALESCE(sum(pg.blk) FILTER (WHERE pg.min > 0), 0))::integer AS total_blk,
  (COALESCE(sum(pg.tov) FILTER (WHERE pg.min > 0), 0))::integer AS total_tov,
  (COALESCE(sum(pg.fgm) FILTER (WHERE pg.min > 0), 0))::integer AS total_fgm,
  (COALESCE(sum(pg.fga) FILTER (WHERE pg.min > 0), 0))::integer AS total_fga,
  (COALESCE(sum(pg."3pm") FILTER (WHERE pg.min > 0), 0))::integer AS total_3pm,
  (COALESCE(sum(pg."3pa") FILTER (WHERE pg.min > 0), 0))::integer AS total_3pa,
  (COALESCE(sum(pg.ftm) FILTER (WHERE pg.min > 0), 0))::integer AS total_ftm,
  (COALESCE(sum(pg.fta) FILTER (WHERE pg.min > 0), 0))::integer AS total_fta,
  (COALESCE(sum(pg.pf) FILTER (WHERE pg.min > 0), 0))::integer AS total_pf,
  (COALESCE(sum(CASE WHEN pg.double_double THEN 1 ELSE 0 END) FILTER (WHERE pg.min > 0), 0))::integer AS total_dd,
  (COALESCE(sum(CASE WHEN pg.triple_double THEN 1 ELSE 0 END) FILTER (WHERE pg.min > 0), 0))::integer AS total_td,
  round(avg(pg.pts) FILTER (WHERE pg.min > 0), 1) AS avg_pts,
  round(avg(pg.reb) FILTER (WHERE pg.min > 0), 1) AS avg_reb,
  round(avg(pg.ast) FILTER (WHERE pg.min > 0), 1) AS avg_ast,
  round(avg(pg.stl) FILTER (WHERE pg.min > 0), 1) AS avg_stl,
  round(avg(pg.blk) FILTER (WHERE pg.min > 0), 1) AS avg_blk,
  round(avg(pg.tov) FILTER (WHERE pg.min > 0), 1) AS avg_tov,
  round(avg(pg.fgm) FILTER (WHERE pg.min > 0), 1) AS avg_fgm,
  round(avg(pg.fga) FILTER (WHERE pg.min > 0), 1) AS avg_fga,
  round(avg(pg."3pm") FILTER (WHERE pg.min > 0), 1) AS avg_3pm,
  round(avg(pg."3pa") FILTER (WHERE pg.min > 0), 1) AS avg_3pa,
  round(avg(pg.ftm) FILTER (WHERE pg.min > 0), 1) AS avg_ftm,
  round(avg(pg.fta) FILTER (WHERE pg.min > 0), 1) AS avg_fta,
  round(avg(pg.pf) FILTER (WHERE pg.min > 0), 1) AS avg_pf,
  round(avg(pg.min) FILTER (WHERE pg.min > 0), 1) AS avg_min,
  -- NFL totals (appended — do not reorder)
  (COALESCE(sum(pg.pass_att) FILTER (WHERE pg.min > 0), 0))::integer AS total_pass_att,
  (COALESCE(sum(pg.pass_cmp) FILTER (WHERE pg.min > 0), 0))::integer AS total_pass_cmp,
  (COALESCE(sum(pg.pass_yd) FILTER (WHERE pg.min > 0), 0))::integer AS total_pass_yd,
  (COALESCE(sum(pg.pass_td) FILTER (WHERE pg.min > 0), 0))::integer AS total_pass_td,
  (COALESCE(sum(pg.pass_int) FILTER (WHERE pg.min > 0), 0))::integer AS total_pass_int,
  (COALESCE(sum(pg.rush_att) FILTER (WHERE pg.min > 0), 0))::integer AS total_rush_att,
  (COALESCE(sum(pg.rush_yd) FILTER (WHERE pg.min > 0), 0))::integer AS total_rush_yd,
  (COALESCE(sum(pg.rush_td) FILTER (WHERE pg.min > 0), 0))::integer AS total_rush_td,
  (COALESCE(sum(pg.rec) FILTER (WHERE pg.min > 0), 0))::integer AS total_rec,
  (COALESCE(sum(pg.targets) FILTER (WHERE pg.min > 0), 0))::integer AS total_targets,
  (COALESCE(sum(pg.rec_yd) FILTER (WHERE pg.min > 0), 0))::integer AS total_rec_yd,
  (COALESCE(sum(pg.rec_td) FILTER (WHERE pg.min > 0), 0))::integer AS total_rec_td,
  (COALESCE(sum(pg.fum_lost) FILTER (WHERE pg.min > 0), 0))::integer AS total_fum_lost,
  (COALESCE(sum(pg.two_pt) FILTER (WHERE pg.min > 0), 0))::integer AS total_two_pt,
  (COALESCE(sum(pg.ret_td) FILTER (WHERE pg.min > 0), 0))::integer AS total_ret_td,
  (COALESCE(sum(pg.fg_made) FILTER (WHERE pg.min > 0), 0))::integer AS total_fg_made,
  (COALESCE(sum(pg.fg_att) FILTER (WHERE pg.min > 0), 0))::integer AS total_fg_att,
  (COALESCE(sum(pg.xp_made) FILTER (WHERE pg.min > 0), 0))::integer AS total_xp_made,
  (COALESCE(sum(pg.xp_att) FILTER (WHERE pg.min > 0), 0))::integer AS total_xp_att,
  (COALESCE(sum(pg.dst_sacks) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_sacks,
  (COALESCE(sum(pg.dst_int) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_int,
  (COALESCE(sum(pg.dst_fum_rec) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_fum_rec,
  (COALESCE(sum(pg.dst_td) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_td,
  (COALESCE(sum(pg.dst_safety) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_safety,
  (COALESCE(sum(pg.dst_pts_allowed) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_pts_allowed,
  (COALESCE(sum(pg.dst_pa_pts) FILTER (WHERE pg.min > 0), 0))::integer AS total_dst_pa_pts,
  -- NFL averages (appended — do not reorder)
  round(avg(pg.pass_att) FILTER (WHERE pg.min > 0), 1) AS avg_pass_att,
  round(avg(pg.pass_cmp) FILTER (WHERE pg.min > 0), 1) AS avg_pass_cmp,
  round(avg(pg.pass_yd) FILTER (WHERE pg.min > 0), 1) AS avg_pass_yd,
  round(avg(pg.pass_td) FILTER (WHERE pg.min > 0), 1) AS avg_pass_td,
  round(avg(pg.pass_int) FILTER (WHERE pg.min > 0), 1) AS avg_pass_int,
  round(avg(pg.rush_att) FILTER (WHERE pg.min > 0), 1) AS avg_rush_att,
  round(avg(pg.rush_yd) FILTER (WHERE pg.min > 0), 1) AS avg_rush_yd,
  round(avg(pg.rush_td) FILTER (WHERE pg.min > 0), 1) AS avg_rush_td,
  round(avg(pg.rec) FILTER (WHERE pg.min > 0), 1) AS avg_rec,
  round(avg(pg.targets) FILTER (WHERE pg.min > 0), 1) AS avg_targets,
  round(avg(pg.rec_yd) FILTER (WHERE pg.min > 0), 1) AS avg_rec_yd,
  round(avg(pg.rec_td) FILTER (WHERE pg.min > 0), 1) AS avg_rec_td,
  round(avg(pg.fum_lost) FILTER (WHERE pg.min > 0), 1) AS avg_fum_lost,
  round(avg(pg.two_pt) FILTER (WHERE pg.min > 0), 1) AS avg_two_pt,
  round(avg(pg.ret_td) FILTER (WHERE pg.min > 0), 1) AS avg_ret_td,
  round(avg(pg.fg_made) FILTER (WHERE pg.min > 0), 1) AS avg_fg_made,
  round(avg(pg.fg_att) FILTER (WHERE pg.min > 0), 1) AS avg_fg_att,
  round(avg(pg.xp_made) FILTER (WHERE pg.min > 0), 1) AS avg_xp_made,
  round(avg(pg.xp_att) FILTER (WHERE pg.min > 0), 1) AS avg_xp_att,
  round(avg(pg.dst_sacks) FILTER (WHERE pg.min > 0), 1) AS avg_dst_sacks,
  round(avg(pg.dst_int) FILTER (WHERE pg.min > 0), 1) AS avg_dst_int,
  round(avg(pg.dst_fum_rec) FILTER (WHERE pg.min > 0), 1) AS avg_dst_fum_rec,
  round(avg(pg.dst_td) FILTER (WHERE pg.min > 0), 1) AS avg_dst_td,
  round(avg(pg.dst_safety) FILTER (WHERE pg.min > 0), 1) AS avg_dst_safety,
  round(avg(pg.dst_pts_allowed) FILTER (WHERE pg.min > 0), 1) AS avg_dst_pts_allowed,
  round(avg(pg.dst_pa_pts) FILTER (WHERE pg.min > 0), 1) AS avg_dst_pa_pts
FROM players p
LEFT JOIN season_floor sf ON sf.sport = p.sport
LEFT JOIN player_games pg
  ON pg.player_id = p.id
 AND pg.game_date > COALESCE(sf.floor_date, '1900-01-01'::date)
GROUP BY p.id, p.name, p."position", p.sport, p.pro_team, p.status,
         p.external_id_nba, p.rookie, p.season_added, p.draft_year, p.birthdate;

ALTER MATERIALIZED VIEW public.player_season_stats OWNER TO postgres;

CREATE UNIQUE INDEX player_season_stats_player_id_idx
  ON public.player_season_stats USING btree (player_id);
CREATE INDEX player_season_stats_sport_idx
  ON public.player_season_stats USING btree (sport);

GRANT SELECT ON public.player_season_stats TO anon, authenticated, service_role;

-- ── 6. Recreate the dependent RPCs ───────────────────────────────────────────

-- Inherits the matview row type, so no column list to maintain.
CREATE FUNCTION public.get_team_roster_stats(p_league_id uuid, p_team_id uuid)
RETURNS SETOF public.player_season_stats
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id AND lp.team_id = p_team_id
    AND is_league_member(p_league_id);
$function$;

-- pss.* expands in matview column order, so the RETURNS TABLE lists below
-- append the NFL columns at the end in exactly the matview's order.
CREATE FUNCTION public.get_league_roster_stats(p_league_id uuid)
RETURNS TABLE(
  team_id uuid, player_id uuid, name text, "position" text, sport text,
  pro_team text, status text, external_id_nba text, rookie boolean,
  season_added text, draft_year integer, birthdate date, games_played integer,
  total_pts integer, total_reb integer, total_ast integer, total_stl integer,
  total_blk integer, total_tov integer, total_fgm integer, total_fga integer,
  total_3pm integer, total_3pa integer, total_ftm integer, total_fta integer,
  total_pf integer, total_dd integer, total_td integer,
  avg_pts numeric, avg_reb numeric, avg_ast numeric, avg_stl numeric,
  avg_blk numeric, avg_tov numeric, avg_fgm numeric, avg_fga numeric,
  avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric,
  total_pass_att integer, total_pass_cmp integer, total_pass_yd integer,
  total_pass_td integer, total_pass_int integer, total_rush_att integer,
  total_rush_yd integer, total_rush_td integer, total_rec integer,
  total_targets integer, total_rec_yd integer, total_rec_td integer,
  total_fum_lost integer, total_two_pt integer, total_ret_td integer,
  total_fg_made integer, total_fg_att integer, total_xp_made integer,
  total_xp_att integer, total_dst_sacks integer, total_dst_int integer,
  total_dst_fum_rec integer, total_dst_td integer, total_dst_safety integer,
  total_dst_pts_allowed integer, total_dst_pa_pts integer,
  avg_pass_att numeric, avg_pass_cmp numeric, avg_pass_yd numeric,
  avg_pass_td numeric, avg_pass_int numeric, avg_rush_att numeric,
  avg_rush_yd numeric, avg_rush_td numeric, avg_rec numeric,
  avg_targets numeric, avg_rec_yd numeric, avg_rec_td numeric,
  avg_fum_lost numeric, avg_two_pt numeric, avg_ret_td numeric,
  avg_fg_made numeric, avg_fg_att numeric, avg_xp_made numeric,
  avg_xp_att numeric, avg_dst_sacks numeric, avg_dst_int numeric,
  avg_dst_fum_rec numeric, avg_dst_td numeric, avg_dst_safety numeric,
  avg_dst_pts_allowed numeric, avg_dst_pa_pts numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT lp.team_id, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id AND lp.team_id IS NOT NULL
    AND is_league_member(p_league_id);
$function$;

CREATE FUNCTION public.get_team_roster_for_trade(p_league_id uuid, p_team_id uuid)
RETURNS TABLE(
  roster_slot text, player_id uuid, name text, "position" text, sport text,
  pro_team text, status text, external_id_nba text, rookie boolean,
  season_added text, draft_year integer, birthdate date, games_played integer,
  total_pts integer, total_reb integer, total_ast integer, total_stl integer,
  total_blk integer, total_tov integer, total_fgm integer, total_fga integer,
  total_3pm integer, total_3pa integer, total_ftm integer, total_fta integer,
  total_pf integer, total_dd integer, total_td integer,
  avg_pts numeric, avg_reb numeric, avg_ast numeric, avg_stl numeric,
  avg_blk numeric, avg_tov numeric, avg_fgm numeric, avg_fga numeric,
  avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric,
  total_pass_att integer, total_pass_cmp integer, total_pass_yd integer,
  total_pass_td integer, total_pass_int integer, total_rush_att integer,
  total_rush_yd integer, total_rush_td integer, total_rec integer,
  total_targets integer, total_rec_yd integer, total_rec_td integer,
  total_fum_lost integer, total_two_pt integer, total_ret_td integer,
  total_fg_made integer, total_fg_att integer, total_xp_made integer,
  total_xp_att integer, total_dst_sacks integer, total_dst_int integer,
  total_dst_fum_rec integer, total_dst_td integer, total_dst_safety integer,
  total_dst_pts_allowed integer, total_dst_pa_pts integer,
  avg_pass_att numeric, avg_pass_cmp numeric, avg_pass_yd numeric,
  avg_pass_td numeric, avg_pass_int numeric, avg_rush_att numeric,
  avg_rush_yd numeric, avg_rush_td numeric, avg_rec numeric,
  avg_targets numeric, avg_rec_yd numeric, avg_rec_td numeric,
  avg_fum_lost numeric, avg_two_pt numeric, avg_ret_td numeric,
  avg_fg_made numeric, avg_fg_att numeric, avg_xp_made numeric,
  avg_xp_att numeric, avg_dst_sacks numeric, avg_dst_int numeric,
  avg_dst_fum_rec numeric, avg_dst_td numeric, avg_dst_safety numeric,
  avg_dst_pts_allowed numeric, avg_dst_pa_pts numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT lp.roster_slot, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id AND lp.team_id = p_team_id
    AND is_league_member(p_league_id);
$function$;

CREATE FUNCTION public.get_draft_queue(p_draft_id uuid, p_team_id uuid, p_league_id uuid)
RETURNS TABLE(
  queue_id uuid, player_id uuid, priority integer, name text, "position" text,
  sport text, pro_team text, status text, external_id_nba text, rookie boolean,
  season_added text, draft_year integer, birthdate date, games_played integer,
  total_pts integer, total_reb integer, total_ast integer, total_stl integer,
  total_blk integer, total_tov integer, total_fgm integer, total_fga integer,
  total_3pm integer, total_3pa integer, total_ftm integer, total_fta integer,
  total_pf integer, total_dd integer, total_td integer,
  avg_pts numeric, avg_reb numeric, avg_ast numeric, avg_stl numeric,
  avg_blk numeric, avg_tov numeric, avg_fgm numeric, avg_fga numeric,
  avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric,
  total_pass_att integer, total_pass_cmp integer, total_pass_yd integer,
  total_pass_td integer, total_pass_int integer, total_rush_att integer,
  total_rush_yd integer, total_rush_td integer, total_rec integer,
  total_targets integer, total_rec_yd integer, total_rec_td integer,
  total_fum_lost integer, total_two_pt integer, total_ret_td integer,
  total_fg_made integer, total_fg_att integer, total_xp_made integer,
  total_xp_att integer, total_dst_sacks integer, total_dst_int integer,
  total_dst_fum_rec integer, total_dst_td integer, total_dst_safety integer,
  total_dst_pts_allowed integer, total_dst_pa_pts integer,
  avg_pass_att numeric, avg_pass_cmp numeric, avg_pass_yd numeric,
  avg_pass_td numeric, avg_pass_int numeric, avg_rush_att numeric,
  avg_rush_yd numeric, avg_rush_td numeric, avg_rec numeric,
  avg_targets numeric, avg_rec_yd numeric, avg_rec_td numeric,
  avg_fum_lost numeric, avg_two_pt numeric, avg_ret_td numeric,
  avg_fg_made numeric, avg_fg_att numeric, avg_xp_made numeric,
  avg_xp_att numeric, avg_dst_sacks numeric, avg_dst_int numeric,
  avg_dst_fum_rec numeric, avg_dst_td numeric, avg_dst_safety numeric,
  avg_dst_pts_allowed numeric, avg_dst_pa_pts numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    pss.avg_pf, pss.avg_min,
    pss.total_pass_att, pss.total_pass_cmp, pss.total_pass_yd,
    pss.total_pass_td, pss.total_pass_int, pss.total_rush_att,
    pss.total_rush_yd, pss.total_rush_td, pss.total_rec,
    pss.total_targets, pss.total_rec_yd, pss.total_rec_td,
    pss.total_fum_lost, pss.total_two_pt, pss.total_ret_td,
    pss.total_fg_made, pss.total_fg_att, pss.total_xp_made,
    pss.total_xp_att, pss.total_dst_sacks, pss.total_dst_int,
    pss.total_dst_fum_rec, pss.total_dst_td, pss.total_dst_safety,
    pss.total_dst_pts_allowed, pss.total_dst_pa_pts,
    pss.avg_pass_att, pss.avg_pass_cmp, pss.avg_pass_yd,
    pss.avg_pass_td, pss.avg_pass_int, pss.avg_rush_att,
    pss.avg_rush_yd, pss.avg_rush_td, pss.avg_rec,
    pss.avg_targets, pss.avg_rec_yd, pss.avg_rec_td,
    pss.avg_fum_lost, pss.avg_two_pt, pss.avg_ret_td,
    pss.avg_fg_made, pss.avg_fg_att, pss.avg_xp_made,
    pss.avg_xp_att, pss.avg_dst_sacks, pss.avg_dst_int,
    pss.avg_dst_fum_rec, pss.avg_dst_td, pss.avg_dst_safety,
    pss.avg_dst_pts_allowed, pss.avg_dst_pa_pts
  FROM draft_queue dq
  JOIN player_season_stats pss ON pss.player_id = dq.player_id
  WHERE dq.draft_id = p_draft_id
    AND dq.team_id = p_team_id
    AND EXISTS (SELECT 1 FROM teams t WHERE t.id = p_team_id AND t.user_id = (SELECT auth.uid()))
    AND dq.player_id NOT IN (
      SELECT lp.player_id FROM league_players lp WHERE lp.league_id = p_league_id
    )
  ORDER BY dq.priority;
$function$;

-- SECURITY DEFINER functions must be owned by postgres (RLS-exempt) and must
-- not be anon-callable (lockdown_security_definer_grants precedent).
ALTER FUNCTION public.get_team_roster_stats(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_league_roster_stats(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_team_roster_for_trade(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_draft_queue(uuid, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_team_roster_stats(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_league_roster_stats(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_league_roster_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) TO authenticated, service_role;
