-- Scope player_season_stats to the CURRENT season.
--
-- The matview aggregated ALL of a player's player_games with no season filter.
-- That only produced correct "this season" numbers because player_games held
-- the current season only. Once prior-season WNBA game logs were backfilled
-- (for the projections engine), every WNBA player's averages started blending
-- multiple seasons. This was a latent bug — the view should always have been
-- season-scoped.
--
-- Fix: only count games AFTER the prior completed season ended, per sport
-- (season_floor). For WNBA (single calendar-year season) that keeps every 2026
-- game — including the pre-opening-night exhibition games that were already
-- counted — and drops 2020-2025. For NBA (two-calendar-year season) it keeps
-- the 2025-26 span. Both derive from season_config, so it stays correct across
-- season turnover. Column set is UNCHANGED, so generated types are unaffected.

-- CASCADE also drops get_team_roster_stats (RETURNS SETOF player_season_stats,
-- a composite-type dependency). It's recreated verbatim at the end.
DROP MATERIALIZED VIEW IF EXISTS public.player_season_stats CASCADE;

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
SELECT p.id AS player_id,
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
    (count(pg.id) FILTER (WHERE (pg.min > 0)))::integer AS games_played,
    (COALESCE(sum(pg.pts) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_pts,
    (COALESCE(sum(pg.reb) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_reb,
    (COALESCE(sum(pg.ast) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_ast,
    (COALESCE(sum(pg.stl) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_stl,
    (COALESCE(sum(pg.blk) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_blk,
    (COALESCE(sum(pg.tov) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_tov,
    (COALESCE(sum(pg.fgm) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_fgm,
    (COALESCE(sum(pg.fga) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_fga,
    (COALESCE(sum(pg."3pm") FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_3pm,
    (COALESCE(sum(pg."3pa") FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_3pa,
    (COALESCE(sum(pg.ftm) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_ftm,
    (COALESCE(sum(pg.fta) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_fta,
    (COALESCE(sum(pg.pf) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_pf,
    (COALESCE(sum(CASE WHEN pg.double_double THEN 1 ELSE 0 END) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_dd,
    (COALESCE(sum(CASE WHEN pg.triple_double THEN 1 ELSE 0 END) FILTER (WHERE (pg.min > 0)), (0)::bigint))::integer AS total_td,
    round(avg(pg.pts) FILTER (WHERE (pg.min > 0)), 1) AS avg_pts,
    round(avg(pg.reb) FILTER (WHERE (pg.min > 0)), 1) AS avg_reb,
    round(avg(pg.ast) FILTER (WHERE (pg.min > 0)), 1) AS avg_ast,
    round(avg(pg.stl) FILTER (WHERE (pg.min > 0)), 1) AS avg_stl,
    round(avg(pg.blk) FILTER (WHERE (pg.min > 0)), 1) AS avg_blk,
    round(avg(pg.tov) FILTER (WHERE (pg.min > 0)), 1) AS avg_tov,
    round(avg(pg.fgm) FILTER (WHERE (pg.min > 0)), 1) AS avg_fgm,
    round(avg(pg.fga) FILTER (WHERE (pg.min > 0)), 1) AS avg_fga,
    round(avg(pg."3pm") FILTER (WHERE (pg.min > 0)), 1) AS avg_3pm,
    round(avg(pg."3pa") FILTER (WHERE (pg.min > 0)), 1) AS avg_3pa,
    round(avg(pg.ftm) FILTER (WHERE (pg.min > 0)), 1) AS avg_ftm,
    round(avg(pg.fta) FILTER (WHERE (pg.min > 0)), 1) AS avg_fta,
    round(avg(pg.pf) FILTER (WHERE (pg.min > 0)), 1) AS avg_pf,
    round(avg(pg.min) FILTER (WHERE (pg.min > 0)), 1) AS avg_min
FROM ((players p
    LEFT JOIN season_floor sf ON (sf.sport = p.sport))
    LEFT JOIN player_games pg ON ((pg.player_id = p.id)
        AND (pg.game_date > COALESCE(sf.floor_date, '1900-01-01'::date))))
GROUP BY p.id, p.name, p."position", p.sport, p.pro_team, p.status, p.external_id_nba, p.rookie, p.season_added, p.draft_year, p.birthdate;

CREATE UNIQUE INDEX player_season_stats_player_id_idx ON public.player_season_stats USING btree (player_id);
CREATE INDEX player_season_stats_sport_idx ON public.player_season_stats USING btree (sport);

GRANT SELECT ON public.player_season_stats TO authenticated;
GRANT ALL ON public.player_season_stats TO service_role;

-- Recreate the dependent RPC dropped by CASCADE (verbatim).
CREATE OR REPLACE FUNCTION public.get_team_roster_stats(p_league_id uuid, p_team_id uuid)
 RETURNS SETOF public.player_season_stats
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) TO authenticated, service_role;
