-- Store real shooting rates on player_historical_stats.
--
-- The table persists per-game averages as numeric(5,1), and every FG%/3P%/FT%
-- in the app was derived by dividing two of those rounded columns. At low
-- volume that's garbage: Al Horford's 2024-25 line (0.55 FTM on 0.64 FTA)
-- stored as avg_ftm=0.6 / avg_fta=0.6 and rendered as FT% 100.0%
-- (user-reported 2026-07-31). 99 of 1,191 rows were showing FT% >= 100%.
--
-- player_season_stats needs no equivalent change — it already carries exact
-- total_fgm/total_fga/total_3pm/total_3pa/total_ftm/total_fta, so the client
-- just has to prefer those over the averages (utils/scoring/shootingPct.ts).
-- Only the historical table lacks shooting totals, hence these columns.
--
-- Nullable on purpose: rows for seasons that predate player_games can only be
-- refilled from the upstream stats API (via the backfill-historical-stats edge
-- function), and until they are, the client falls back to the old rounded
-- math rather than showing a blank.

ALTER TABLE public.player_historical_stats
  ADD COLUMN IF NOT EXISTS fg_pct  numeric(4,3),
  ADD COLUMN IF NOT EXISTS fg3_pct numeric(4,3),
  ADD COLUMN IF NOT EXISTS ft_pct  numeric(4,3);

COMMENT ON COLUMN public.player_historical_stats.fg_pct IS
  'Season field-goal rate as a fraction (0-1). Exact — never derive this from avg_fgm/avg_fga, which are rounded to 1dp.';
COMMENT ON COLUMN public.player_historical_stats.fg3_pct IS
  'Season three-point rate as a fraction (0-1). Exact — never derive this from avg_3pm/avg_3pa, which are rounded to 1dp.';
COMMENT ON COLUMN public.player_historical_stats.ft_pct IS
  'Season free-throw rate as a fraction (0-1). Exact — never derive this from avg_ftm/avg_fta, which are rounded to 1dp.';

-- Backfill every season still covered by player_games (NBA 2025-26, WNBA
-- 2020-2026) straight from the box scores. Same min > 0 filter and
-- season_config window archive_season_player_stats uses, so the two agree.
-- Seasons with no game rows (NBA 2024-25) stay NULL for the API backfill.
WITH season_sums AS (
  SELECT phs.id,
         sum(pg.fgm)   AS fgm,
         sum(pg.fga)   AS fga,
         sum(pg."3pm") AS tpm,
         sum(pg."3pa") AS tpa,
         sum(pg.ftm)   AS ftm,
         sum(pg.fta)   AS fta
  FROM player_historical_stats phs
  JOIN season_config sc
    ON sc.sport = phs.sport
   AND sc.season = phs.season
  JOIN player_games pg
    ON pg.player_id = phs.player_id
   AND pg.min > 0
   AND pg.game_date BETWEEN sc.start_date AND sc.end_date
  GROUP BY phs.id
)
UPDATE player_historical_stats phs
SET fg_pct  = CASE WHEN s.fga > 0 THEN round(s.fgm::numeric / s.fga, 3) END,
    fg3_pct = CASE WHEN s.tpa > 0 THEN round(s.tpm::numeric / s.tpa, 3) END,
    ft_pct  = CASE WHEN s.fta > 0 THEN round(s.ftm::numeric / s.fta, 3) END
FROM season_sums s
WHERE s.id = phs.id;

-- Go-forward: the rollover archiver writes the rates itself, from the same
-- sums it already scans. Body is unchanged apart from the three columns.
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
    fg_pct, fg3_pct, ft_pct,
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
    -- Rates from the SUMS, not the rounded averages above.
    CASE WHEN sum(pg.fga)   > 0 THEN round(sum(pg.fgm)::numeric   / sum(pg.fga), 3) END,
    CASE WHEN sum(pg."3pa") > 0 THEN round(sum(pg."3pm")::numeric / sum(pg."3pa"), 3) END,
    CASE WHEN sum(pg.fta)   > 0 THEN round(sum(pg.ftm)::numeric   / sum(pg.fta), 3) END,
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
    fg_pct = EXCLUDED.fg_pct, fg3_pct = EXCLUDED.fg3_pct, ft_pct = EXCLUDED.ft_pct,
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
