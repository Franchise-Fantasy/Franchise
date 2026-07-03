-- Archive a completed season's per-player averages into player_historical_stats.
--
-- player_season_stats (the live current-season matview) rescopes to the new
-- season the instant season_config.is_current flips, so the just-ended season's
-- averages vanish from the player-detail "previous seasons" chips unless they're
-- snapshotted first. This recomputes the season's box-score line directly from
-- player_games over the season's start_date..end_date window (same min>0 filter
-- and 1-dp rounding the matview uses), so it works retroactively for ANY season
-- still present in player_games — not just the live one. That matters because by
-- the time you notice the gap, is_current has usually already moved on (NBA
-- 2025-26 was lost exactly this way).
--
-- Idempotent: UPSERT on (player_id, season). Run as part of the global season
-- rollover — order vs. the is_current flip doesn't matter (date-range based).
-- See CLAUDE.md "season rollover" runbook.
--
-- Internal admin helper: no auth check of its own, only run by service_role via
-- SQL during rollover, so EXECUTE is revoked from anon + authenticated.

CREATE OR REPLACE FUNCTION public.archive_season_player_stats(p_sport text, p_season text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start date;
  v_end   date;
  v_count integer;
BEGIN
  SELECT start_date, end_date INTO v_start, v_end
  FROM season_config
  WHERE sport = p_sport AND season = p_season;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'No season_config row for sport=% season=%', p_sport, p_season;
  END IF;

  INSERT INTO player_historical_stats (
    player_id, season, sport, games_played, pro_team,
    avg_pts, avg_reb, avg_ast, avg_stl, avg_blk, avg_tov, avg_min,
    avg_fgm, avg_fga, avg_3pm, avg_3pa, avg_ftm, avg_fta, avg_pf,
    total_pts, total_reb, total_ast, total_stl, total_blk, total_tov,
    total_dd, total_td
  )
  SELECT
    p.id, p_season, p_sport,
    count(pg.id)::int,
    p.pro_team,
    round(avg(pg.pts), 1), round(avg(pg.reb), 1), round(avg(pg.ast), 1),
    round(avg(pg.stl), 1), round(avg(pg.blk), 1), round(avg(pg.tov), 1),
    round(avg(pg.min), 1),
    round(avg(pg.fgm), 1), round(avg(pg.fga), 1), round(avg(pg."3pm"), 1),
    round(avg(pg."3pa"), 1), round(avg(pg.ftm), 1), round(avg(pg.fta), 1),
    round(avg(pg.pf), 1),
    coalesce(sum(pg.pts), 0)::int, coalesce(sum(pg.reb), 0)::int,
    coalesce(sum(pg.ast), 0)::int, coalesce(sum(pg.stl), 0)::int,
    coalesce(sum(pg.blk), 0)::int, coalesce(sum(pg.tov), 0)::int,
    coalesce(sum(CASE WHEN pg.double_double THEN 1 ELSE 0 END), 0)::int,
    coalesce(sum(CASE WHEN pg.triple_double THEN 1 ELSE 0 END), 0)::int
  FROM players p
  JOIN player_games pg
    ON pg.player_id = p.id
   AND pg.min > 0
   AND pg.game_date BETWEEN v_start AND v_end
  WHERE p.sport = p_sport
  GROUP BY p.id, p.pro_team
  ON CONFLICT (player_id, season) DO UPDATE SET
    sport = EXCLUDED.sport,
    games_played = EXCLUDED.games_played,
    pro_team = EXCLUDED.pro_team,
    avg_pts = EXCLUDED.avg_pts, avg_reb = EXCLUDED.avg_reb, avg_ast = EXCLUDED.avg_ast,
    avg_stl = EXCLUDED.avg_stl, avg_blk = EXCLUDED.avg_blk, avg_tov = EXCLUDED.avg_tov,
    avg_min = EXCLUDED.avg_min, avg_fgm = EXCLUDED.avg_fgm, avg_fga = EXCLUDED.avg_fga,
    avg_3pm = EXCLUDED.avg_3pm, avg_3pa = EXCLUDED.avg_3pa, avg_ftm = EXCLUDED.avg_ftm,
    avg_fta = EXCLUDED.avg_fta, avg_pf = EXCLUDED.avg_pf,
    total_pts = EXCLUDED.total_pts, total_reb = EXCLUDED.total_reb, total_ast = EXCLUDED.total_ast,
    total_stl = EXCLUDED.total_stl, total_blk = EXCLUDED.total_blk, total_tov = EXCLUDED.total_tov,
    total_dd = EXCLUDED.total_dd, total_td = EXCLUDED.total_td;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_season_player_stats(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_season_player_stats(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_season_player_stats(text, text) TO service_role;
