-- NFL support for get_week_score_data (the one-round-trip bundle behind the
-- get-week-scores edge function).
--
-- Changes vs the previous definition:
--   1. The bundle gains a top-level 'sport' (from leagues.sport) so the edge
--      function picks the right stat map without a second query.
--   2. 'games' and 'live' rows are built sport-conditionally: basketball
--      leagues keep the exact previous shape (no payload bloat), NFL leagues
--      get the NFL stat columns instead (scoring columns + the display extras
--      pass_cmp/pass_att/fg_att/dst_pts_allowed).
--
-- ⚠ SQL↔TS pairing: the NFL column list here must stay in step with
-- NFL_STAT_TO_GAME in utils/sports/registry.ts and NFL_PAYLOAD_COLUMNS in
-- supabase/functions/_shared/finalizeWeek/teamScoring.ts. If a new NFL stat
-- column starts being scored, add it in all three places.
--
-- CREATE OR REPLACE preserves the existing grants (service_role-only per the
-- lockdown migrations) and the SECURITY DEFINER + search_path hardening.

CREATE OR REPLACE FUNCTION public.get_week_score_data(p_league_id uuid, p_schedule_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_week record;
  v_today date := (current_timestamp AT TIME ZONE 'America/New_York')::date;
  v_week_is_live boolean;
  v_game_end_date date;
  v_team_ids uuid[];
  v_scoring_type text;
  v_sport text;
  result json;
BEGIN
  -- Get week info
  SELECT id, week_number, start_date, end_date, is_playoff
    INTO v_week
    FROM league_schedule WHERE id = p_schedule_id;

  IF v_week IS NULL THEN
    RETURN json_build_object('error', 'week not found');
  END IF;

  -- Get league scoring type + sport
  SELECT scoring_type, COALESCE(sport, 'nba') INTO v_scoring_type, v_sport
    FROM leagues WHERE id = p_league_id;

  v_week_is_live := v_week.start_date <= v_today AND v_today <= v_week.end_date;
  v_game_end_date := CASE WHEN v_week_is_live THEN v_today - 1 ELSE v_week.end_date END;

  -- Compute matchup team IDs ONCE
  SELECT ARRAY(
    SELECT DISTINCT unnest(ARRAY[lm.home_team_id, lm.away_team_id])
    FROM league_matchups lm WHERE lm.schedule_id = p_schedule_id
  ) INTO v_team_ids;

  SELECT json_build_object(
    'week', json_build_object(
      'id', v_week.id,
      'week_number', v_week.week_number,
      'start_date', v_week.start_date,
      'end_date', v_week.end_date,
      'is_playoff', v_week.is_playoff
    ),
    'scoring_type', v_scoring_type,
    'sport', v_sport,
    'scoring', COALESCE((
      SELECT json_agg(json_build_object(
        'stat_name', s.stat_name,
        'point_value', s.point_value,
        'is_enabled', s.is_enabled,
        'inverse', s.inverse
      ))
      FROM league_scoring_settings s WHERE s.league_id = p_league_id
    ), '[]'::json),
    'matchups', COALESCE((
      SELECT json_agg(json_build_object('id', m.id, 'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id))
      FROM league_matchups m WHERE m.schedule_id = p_schedule_id
    ), '[]'::json),
    'rosters', COALESCE((
      SELECT json_agg(json_build_object(
        'player_id', lp.player_id, 'team_id', lp.team_id,
        'roster_slot', lp.roster_slot, 'acquired_at', lp.acquired_at
      ))
      FROM league_players lp
      WHERE lp.league_id = p_league_id
        AND lp.team_id = ANY(v_team_ids)
    ), '[]'::json),
    'lineups', COALESCE((
      SELECT json_agg(row_order)
      FROM (
        SELECT json_build_object(
          'player_id', dl.player_id, 'team_id', dl.team_id,
          'roster_slot', dl.roster_slot, 'lineup_date', dl.lineup_date
        ) AS row_order
        FROM daily_lineups dl
        WHERE dl.league_id = p_league_id
          AND dl.team_id = ANY(v_team_ids)
          AND dl.lineup_date <= v_week.end_date
        ORDER BY dl.lineup_date DESC
      ) sub
    ), '[]'::json),
    'games', COALESCE((
      SELECT json_agg(
        CASE WHEN v_sport = 'nfl' THEN json_build_object(
          'player_id', pg.player_id, 'game_date', pg.game_date,
          'pass_cmp', pg.pass_cmp, 'pass_att', pg.pass_att, 'pass_yd', pg.pass_yd,
          'pass_td', pg.pass_td, 'pass_int', pg.pass_int,
          'rush_att', pg.rush_att, 'rush_yd', pg.rush_yd, 'rush_td', pg.rush_td,
          'rec', pg.rec, 'targets', pg.targets, 'rec_yd', pg.rec_yd, 'rec_td', pg.rec_td,
          'fum_lost', pg.fum_lost, 'ret_td', pg.ret_td,
          'fg_made', pg.fg_made, 'fg_att', pg.fg_att, 'xp_made', pg.xp_made,
          'dst_sacks', pg.dst_sacks, 'dst_int', pg.dst_int, 'dst_fum_rec', pg.dst_fum_rec,
          'dst_td', pg.dst_td, 'dst_pts_allowed', pg.dst_pts_allowed, 'dst_pa_pts', pg.dst_pa_pts
        ) ELSE json_build_object(
          'player_id', pg.player_id, 'game_date', pg.game_date,
          'pts', pg.pts, 'reb', pg.reb, 'ast', pg.ast, 'stl', pg.stl,
          'blk', pg.blk, 'tov', pg.tov, 'fgm', pg.fgm, 'fga', pg.fga,
          '3pm', pg."3pm", '3pa', pg."3pa", 'ftm', pg.ftm, 'fta', pg.fta,
          'pf', pg.pf, 'double_double', pg.double_double, 'triple_double', pg.triple_double
        ) END
      )
      FROM player_games pg
      WHERE pg.player_id IN (
        SELECT lp2.player_id FROM league_players lp2
        WHERE lp2.league_id = p_league_id
          AND lp2.team_id = ANY(v_team_ids)
        UNION
        SELECT dl2.player_id FROM daily_lineups dl2
        WHERE dl2.league_id = p_league_id
          AND dl2.team_id = ANY(v_team_ids)
          AND dl2.lineup_date <= v_week.end_date
      )
      AND pg.game_date >= v_week.start_date
      AND pg.game_date <= v_game_end_date
    ), '[]'::json),
    'live', CASE WHEN v_week_is_live THEN COALESCE((
      SELECT json_agg(
        CASE WHEN v_sport = 'nfl' THEN json_build_object(
          'player_id', ls.player_id, 'game_date', ls.game_date,
          'game_status', ls.game_status,
          'pass_cmp', ls.pass_cmp, 'pass_att', ls.pass_att, 'pass_yd', ls.pass_yd,
          'pass_td', ls.pass_td, 'pass_int', ls.pass_int,
          'rush_att', ls.rush_att, 'rush_yd', ls.rush_yd, 'rush_td', ls.rush_td,
          'rec', ls.rec, 'targets', ls.targets, 'rec_yd', ls.rec_yd, 'rec_td', ls.rec_td,
          'fum_lost', ls.fum_lost, 'ret_td', ls.ret_td,
          'fg_made', ls.fg_made, 'fg_att', ls.fg_att, 'xp_made', ls.xp_made,
          'dst_sacks', ls.dst_sacks, 'dst_int', ls.dst_int, 'dst_fum_rec', ls.dst_fum_rec,
          'dst_td', ls.dst_td, 'dst_pts_allowed', ls.dst_pts_allowed, 'dst_pa_pts', ls.dst_pa_pts
        ) ELSE json_build_object(
          'player_id', ls.player_id, 'game_date', ls.game_date,
          'game_status', ls.game_status,
          'pts', ls.pts, 'reb', ls.reb, 'ast', ls.ast, 'stl', ls.stl,
          'blk', ls.blk, 'tov', ls.tov, 'fgm', ls.fgm, 'fga', ls.fga,
          '3pm', ls."3pm", '3pa', ls."3pa", 'ftm', ls.ftm, 'fta', ls.fta, 'pf', ls.pf
        ) END
      )
      FROM live_player_stats ls
      WHERE ls.player_id IN (
        SELECT lp3.player_id FROM league_players lp3
        WHERE lp3.league_id = p_league_id
          AND lp3.team_id = ANY(v_team_ids)
        UNION
        SELECT dl3.player_id FROM daily_lineups dl3
        WHERE dl3.league_id = p_league_id
          AND dl3.team_id = ANY(v_team_ids)
          AND dl3.lineup_date <= v_week.end_date
      )
      AND ls.game_status >= 2
      AND (
        ls.game_date = v_today
        OR (ls.game_date = v_today - 1 AND ls.game_status = 2 AND v_today - 1 >= v_week.start_date)
      )
    ), '[]'::json) ELSE '[]'::json END
  ) INTO result;

  RETURN result;
END;
$function$;
