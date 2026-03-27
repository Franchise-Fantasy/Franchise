DO $$
DECLARE
  v_user1 uuid := 'a3adaf6b-20b5-4059-b860-d49f146c78fd';
  v_user2 uuid := 'be58f785-5248-4aa6-97d6-083ae10c2f91';
  v_league_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_draft_id uuid;
  v_round int;
  v_slot int;
  v_pick_num int;
  v_team_id uuid;
BEGIN
  -- 1. Create league (dynasty, 2 teams, draft pick trading enabled)
  INSERT INTO leagues (
    name, created_by, league_type, teams, roster_size,
    season, regular_season_weeks, playoff_weeks, playoff_teams,
    season_start_date, trade_review_period_hours, trade_veto_type,
    scoring_type, draft_pick_trading_enabled, pick_conditions_enabled,
    max_future_seasons, rookie_draft_rounds, rookie_draft_order,
    waiver_type, waiver_period_days, player_lock_type,
    initial_draft_order, division_count
  ) VALUES (
    'Draft Test League', v_user1, 'dynasty', 2, 13,
    '2025-26', 20, 3, 2,
    '2026-03-23', 0, 'none',
    'points', true, false,
    3, 2, 'reverse_record',
    'standard', 1, 'individual_game',
    'random', 1
  ) RETURNING id INTO v_league_id;

  -- 2. Create teams
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner)
  VALUES (v_league_id, v_user1, 'Team Spoels', 'SPL', true)
  RETURNING id INTO v_team1_id;

  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner)
  VALUES (v_league_id, v_user2, 'Team Proton', 'PRO', false)
  RETURNING id INTO v_team2_id;

  -- 3. Roster config
  INSERT INTO league_roster_config (league_id, position, slot_count) VALUES
    (v_league_id, 'PG', 1),
    (v_league_id, 'SG', 1),
    (v_league_id, 'SF', 1),
    (v_league_id, 'PF', 1),
    (v_league_id, 'C', 1),
    (v_league_id, 'G', 1),
    (v_league_id, 'F', 1),
    (v_league_id, 'UTIL', 3),
    (v_league_id, 'BE', 3),
    (v_league_id, 'IR', 1);

  -- 4. Scoring settings (default points)
  INSERT INTO league_scoring_settings (league_id, stat_name, point_value, is_enabled, inverse) VALUES
    (v_league_id, 'PTS', 1, true, false),
    (v_league_id, 'REB', 1.2, true, false),
    (v_league_id, 'AST', 1.5, true, false),
    (v_league_id, 'STL', 3, true, false),
    (v_league_id, 'BLK', 3, true, false),
    (v_league_id, 'TO', -1, true, false),
    (v_league_id, '3PM', 1, true, false),
    (v_league_id, '3PA', 0, true, false),
    (v_league_id, 'FGM', 2, true, false),
    (v_league_id, 'FGA', -1, true, false),
    (v_league_id, 'FTM', 1, true, false),
    (v_league_id, 'FTA', -1, true, false),
    (v_league_id, 'PF', -1, true, false),
    (v_league_id, 'DD', 0, true, false),
    (v_league_id, 'TD', 0, true, false);

  -- 5. Create draft (10 rounds, 30s per pick, snake)
  INSERT INTO drafts (
    league_id, season, type, status, rounds,
    picks_per_round, time_limit, draft_type
  ) VALUES (
    v_league_id, '2025-26', 'initial', 'unscheduled', 10,
    2, 60, 'snake'
  ) RETURNING id INTO v_draft_id;

  -- 6. Generate snake draft picks (10 rounds x 2 teams = 20 picks)
  FOR v_round IN 1..10 LOOP
    IF v_round % 2 = 0 THEN
      FOR v_slot IN REVERSE 2..1 LOOP
        v_pick_num := (v_round - 1) * 2 + (2 - v_slot + 1);
        IF v_slot = 1 THEN v_team_id := v_team1_id; ELSE v_team_id := v_team2_id; END IF;
        INSERT INTO draft_picks (
          league_id, draft_id, season, round, pick_number,
          slot_number, original_team_id, current_team_id
        ) VALUES (
          v_league_id, v_draft_id, '2025-26', v_round, v_pick_num,
          v_slot, v_team_id, v_team_id
        );
      END LOOP;
    ELSE
      FOR v_slot IN 1..2 LOOP
        v_pick_num := (v_round - 1) * 2 + v_slot;
        IF v_slot = 1 THEN v_team_id := v_team1_id; ELSE v_team_id := v_team2_id; END IF;
        INSERT INTO draft_picks (
          league_id, draft_id, season, round, pick_number,
          slot_number, original_team_id, current_team_id
        ) VALUES (
          v_league_id, v_draft_id, '2025-26', v_round, v_pick_num,
          v_slot, v_team_id, v_team_id
        );
      END LOOP;
    END IF;
  END LOOP;

  -- 7. Generate future rookie draft picks (3 future seasons x 2 rounds x 2 teams)
  FOR v_round IN 1..2 LOOP
    FOR v_slot IN 1..2 LOOP
      IF v_slot = 1 THEN v_team_id := v_team1_id; ELSE v_team_id := v_team2_id; END IF;
      INSERT INTO draft_picks (league_id, season, round, slot_number, original_team_id, current_team_id, pick_number) VALUES
        (v_league_id, '2026-27', v_round, v_slot, v_team_id, v_team_id, (v_round-1)*2+v_slot),
        (v_league_id, '2027-28', v_round, v_slot, v_team_id, v_team_id, (v_round-1)*2+v_slot),
        (v_league_id, '2028-29', v_round, v_slot, v_team_id, v_team_id, (v_round-1)*2+v_slot);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'League: % | Team1: % | Team2: % | Draft: %', v_league_id, v_team1_id, v_team2_id, v_draft_id;
END $$;
