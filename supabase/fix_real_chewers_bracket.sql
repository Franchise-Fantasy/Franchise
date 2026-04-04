-- One-time fix: clear and re-seed "Real Chewers" playoff bracket
-- Run in Supabase SQL Editor, then re-invoke generate-playoff-round for the league

BEGIN;

-- Find the league
DO $$
DECLARE
  v_league_id uuid;
  v_season    int;
BEGIN
  SELECT id, season INTO v_league_id, v_season
    FROM leagues
   WHERE name = 'Real Chewers'
   LIMIT 1;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'League "Real Chewers" not found';
  END IF;

  RAISE NOTICE 'Cleaning up league % season %', v_league_id, v_season;

  -- 1. Delete playoff bracket rows
  DELETE FROM playoff_bracket
   WHERE league_id = v_league_id
     AND season = v_season;

  -- 2. Delete seed pick rows (if higher-seed-picks format was used)
  DELETE FROM playoff_seed_picks
   WHERE league_id = v_league_id
     AND season = v_season;

  -- 3. Delete playoff matchup rows (league_matchups with playoff_round set)
  DELETE FROM league_matchups
   WHERE league_id = v_league_id
     AND playoff_round IS NOT NULL;

  RAISE NOTICE 'Done — now deploy the updated edge function and call generate-playoff-round with league_id = %', v_league_id;
END $$;

COMMIT;
