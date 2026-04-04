-- Consolidates the matchup screen's sequential waterfall into a single RPC.
-- Replaces: fetchWeeks → find current week → fetchMatchupForWeek →
-- fetchTeamInfo x2 → fetchAllWeekMatchups (6 queries → 1 round trip).
-- Shared hooks (useLeagueScoring, useLeagueRosterConfig) remain client-side
-- since they're cached across many screens.

CREATE OR REPLACE FUNCTION public.get_matchup_init(
  p_league_id uuid,
  p_team_id uuid,
  p_date text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_weeks jsonb;
  v_current_week record;
  v_matchup record;
  v_all_matchups jsonb;
  v_home_team jsonb;
  v_away_team jsonb;
BEGIN
  -- Auth check
  IF NOT EXISTS (
    SELECT 1 FROM teams WHERE id = p_team_id AND user_id = v_uid AND league_id = p_league_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- All schedule weeks
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ls.id,
      'week_number', ls.week_number,
      'start_date', ls.start_date,
      'end_date', ls.end_date,
      'is_playoff', ls.is_playoff
    ) ORDER BY ls.week_number
  ) INTO v_weeks
  FROM league_schedule ls
  WHERE ls.league_id = p_league_id;

  -- Find the current week for the given date
  SELECT * INTO v_current_week
  FROM league_schedule
  WHERE league_id = p_league_id
    AND start_date <= p_date::date
    AND end_date >= p_date::date
  LIMIT 1;

  -- If no current week found, return weeks only
  IF v_current_week IS NULL THEN
    RETURN jsonb_build_object(
      'weeks', COALESCE(v_weeks, '[]'::jsonb),
      'current_matchup', null,
      'all_week_matchups', '[]'::jsonb,
      'home_team', null,
      'away_team', null
    );
  END IF;

  -- User's matchup for the current week
  SELECT * INTO v_matchup
  FROM league_matchups
  WHERE schedule_id = v_current_week.id
    AND (home_team_id = p_team_id OR away_team_id = p_team_id)
  LIMIT 1;

  -- All matchups for the pill bar
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', lm.id,
      'home_team_id', lm.home_team_id,
      'away_team_id', lm.away_team_id
    )
  ) INTO v_all_matchups
  FROM league_matchups lm
  WHERE lm.schedule_id = v_current_week.id;

  -- Team info for both sides of the matchup
  IF v_matchup IS NOT NULL THEN
    SELECT jsonb_build_object('name', t.name, 'logo_key', t.logo_key)
      INTO v_home_team
      FROM teams t WHERE t.id = v_matchup.home_team_id;

    IF v_matchup.away_team_id IS NOT NULL THEN
      SELECT jsonb_build_object('name', t.name, 'logo_key', t.logo_key)
        INTO v_away_team
        FROM teams t WHERE t.id = v_matchup.away_team_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'weeks', COALESCE(v_weeks, '[]'::jsonb),
    'current_matchup', CASE WHEN v_matchup IS NOT NULL THEN jsonb_build_object(
      'id', v_matchup.id,
      'home_team_id', v_matchup.home_team_id,
      'away_team_id', v_matchup.away_team_id,
      'home_score', v_matchup.home_score,
      'away_score', v_matchup.away_score,
      'playoff_round', v_matchup.playoff_round,
      'is_finalized', v_matchup.is_finalized,
      'home_player_scores', v_matchup.home_player_scores,
      'away_player_scores', v_matchup.away_player_scores
    ) ELSE null END,
    'all_week_matchups', COALESCE(v_all_matchups, '[]'::jsonb),
    'home_team', v_home_team,
    'away_team', v_away_team
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_matchup_init(uuid, uuid, text) TO authenticated;
