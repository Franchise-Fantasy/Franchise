-- Seed a 6-team H2H Categories test league with completed draft,
-- rosters, schedule (2 weeks regular season, 0 playoffs), and matchups.
-- Run via: npx supabase db query --linked < backend/seed_cat_league.sql

DO $$
DECLARE
  -- Users
  v_user_spoels    uuid := 'a3adaf6b-20b5-4059-b860-d49f146c78fd'; -- jjspoels@gmail.com
  v_user_noah      uuid := 'da0cf3c8-3305-4833-a6ac-2107597a3d92'; -- noahgordon2021@outlook.com
  v_user_goldman   uuid := '4809c835-d96c-47a3-a04c-a1c77d706dd7'; -- samuel.goldman14@gmail.com
  v_user_bchurch   uuid := '4526bfd1-c2f1-4001-b82c-9dbed61401bd'; -- brycechurch7@gmail.com
  v_user_engel     uuid := 'c36c03fd-a907-44a1-8582-2ccdbadd3429'; -- wbengelhardt@gmail.com
  v_user_proton    uuid := 'be58f785-5248-4aa6-97d6-083ae10c2f91'; -- jjspoelstra23@proton.me

  v_league_id uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid; v_t6 uuid;
  v_draft_id uuid;

  -- Schedule
  v_sched1 uuid; v_sched2 uuid;
BEGIN
  -----------------------------------------------------------------
  -- 1. LEAGUE
  -----------------------------------------------------------------
  INSERT INTO leagues (
    name, created_by, league_type, teams, current_teams, roster_size,
    season, regular_season_weeks, playoff_weeks, playoff_teams,
    season_start_date, trade_review_period_hours, trade_veto_type,
    scoring_type, draft_pick_trading_enabled, pick_conditions_enabled,
    max_future_seasons, rookie_draft_rounds, rookie_draft_order,
    waiver_type, waiver_period_days, player_lock_type,
    initial_draft_order, division_count, schedule_generated,
    weekly_acquisition_limit
  ) VALUES (
    'CAT Test League', v_user_spoels, 'redraft', 6, 6, 13,
    '2025-26', 2, 0, 0,
    '2026-03-30', 0, 'none',
    'h2h_categories', false, false,
    0, 0, 'reverse_record',
    'standard', 1, 'individual_game',
    'random', 1, true,
    4
  ) RETURNING id INTO v_league_id;

  -----------------------------------------------------------------
  -- 2. TEAMS
  -----------------------------------------------------------------
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner, division)
  VALUES (v_league_id, v_user_spoels,  'Team Spoels',      'SPL', true,  1) RETURNING id INTO v_t1;
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner, division)
  VALUES (v_league_id, v_user_noah,    'Team Noah',        'NOA', false, 1) RETURNING id INTO v_t2;
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner, division)
  VALUES (v_league_id, v_user_goldman, 'Team Goldman',     'GLD', false, 1) RETURNING id INTO v_t3;
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner, division)
  VALUES (v_league_id, v_user_bchurch, 'Team Church',      'CHR', false, 1) RETURNING id INTO v_t4;
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner, division)
  VALUES (v_league_id, v_user_engel,   'Team Engelhardt',  'ENG', false, 1) RETURNING id INTO v_t5;
  INSERT INTO teams (league_id, user_id, name, tricode, is_commissioner, division)
  VALUES (v_league_id, v_user_proton,  'Team Proton',      'PRO', false, 1) RETURNING id INTO v_t6;

  -----------------------------------------------------------------
  -- 3. ROSTER CONFIG (13 active + 1 IR)
  -----------------------------------------------------------------
  INSERT INTO league_roster_config (league_id, position, slot_count) VALUES
    (v_league_id, 'PG',   1),
    (v_league_id, 'SG',   1),
    (v_league_id, 'SF',   1),
    (v_league_id, 'PF',   1),
    (v_league_id, 'C',    1),
    (v_league_id, 'G',    1),
    (v_league_id, 'F',    1),
    (v_league_id, 'UTIL', 3),
    (v_league_id, 'BE',   3),
    (v_league_id, 'IR',   1);

  -----------------------------------------------------------------
  -- 4. SCORING SETTINGS (9-CAT)
  -----------------------------------------------------------------
  INSERT INTO league_scoring_settings (league_id, stat_name, point_value, is_enabled, inverse) VALUES
    (v_league_id, 'PTS',  0, true, false),
    (v_league_id, 'REB',  0, true, false),
    (v_league_id, 'AST',  0, true, false),
    (v_league_id, 'STL',  0, true, false),
    (v_league_id, 'BLK',  0, true, false),
    (v_league_id, 'TO',   0, true, true),
    (v_league_id, '3PM',  0, true, false),
    (v_league_id, 'FG%',  0, true, false),
    (v_league_id, 'FT%',  0, true, false);

  -----------------------------------------------------------------
  -- 5. COMPLETED DRAFT (13 rounds x 6 teams = 78 picks, snake)
  -----------------------------------------------------------------
  INSERT INTO drafts (
    league_id, season, type, status, rounds,
    picks_per_round, time_limit, draft_type, current_pick_number
  ) VALUES (
    v_league_id, '2025-26', 'initial', 'complete', 13,
    6, 60, 'snake', 79
  ) RETURNING id INTO v_draft_id;

  -- Snake draft picks with player assignments
  -- Rd 1 (→): T1=SGA, T2=KD, T3=Mitchell, T4=Maxey, T5=Brunson, T6=J.Murray
  -- Rd 2 (←): T6=Kawhi, T5=Jokic, T4=Randle, T3=Bane, T2=Booker, T1=J.Johnson
  -- ... continues snake for 13 rounds

  INSERT INTO draft_picks (league_id, draft_id, season, round, pick_number, slot_number, original_team_id, current_team_id, player_id, selected_at) VALUES
    -- Round 1
    (v_league_id, v_draft_id, '2025-26', 1,  1, 1, v_t1, v_t1, 'd50eaf07-b314-4e0f-be90-90f618e1cd08', now()),  -- SGA
    (v_league_id, v_draft_id, '2025-26', 1,  2, 2, v_t2, v_t2, 'f7909beb-3309-4b4d-a2eb-d3218d42988c', now()),  -- KD
    (v_league_id, v_draft_id, '2025-26', 1,  3, 3, v_t3, v_t3, 'e4de86d0-cd56-4810-b2e2-4d41b835d790', now()),  -- Donovan Mitchell
    (v_league_id, v_draft_id, '2025-26', 1,  4, 4, v_t4, v_t4, 'aa17549f-2ddf-492c-b1bb-427a5dbec678', now()),  -- Tyrese Maxey
    (v_league_id, v_draft_id, '2025-26', 1,  5, 5, v_t5, v_t5, '6f21e902-f378-4a25-a2ab-15c8bc3f2c19', now()),  -- Jalen Brunson
    (v_league_id, v_draft_id, '2025-26', 1,  6, 6, v_t6, v_t6, 'bb2764ff-7d0d-48a2-88be-4146d47800a1', now()),  -- Jamal Murray
    -- Round 2 (reversed)
    (v_league_id, v_draft_id, '2025-26', 2,  7, 6, v_t6, v_t6, '9ca0d830-ae6c-4561-87f6-226124a6e74a', now()),  -- Kawhi
    (v_league_id, v_draft_id, '2025-26', 2,  8, 5, v_t5, v_t5, '53ba47f0-7121-4740-af77-6ade8ba807af', now()),  -- Jokic
    (v_league_id, v_draft_id, '2025-26', 2,  9, 4, v_t4, v_t4, '14914116-c9cf-4b32-9590-fb9b112378f5', now()),  -- Randle
    (v_league_id, v_draft_id, '2025-26', 2, 10, 3, v_t3, v_t3, '8e2d5184-9b01-49a3-81f1-304816e56211', now()),  -- Bane
    (v_league_id, v_draft_id, '2025-26', 2, 11, 2, v_t2, v_t2, '74900e13-e57c-4ceb-8151-74696055047f', now()),  -- Booker
    (v_league_id, v_draft_id, '2025-26', 2, 12, 1, v_t1, v_t1, '2da678ce-5e57-4791-9426-a8c94aa51bf2', now()),  -- Jalen Johnson
    -- Round 3
    (v_league_id, v_draft_id, '2025-26', 3, 13, 1, v_t1, v_t1, '0ba2aa96-e358-4a65-a1ee-c26eeea61d64', now()),  -- NAW
    (v_league_id, v_draft_id, '2025-26', 3, 14, 2, v_t2, v_t2, '1051c5c6-2682-4a7a-a0a1-2c8aa80213d4', now()),  -- Banchero
    (v_league_id, v_draft_id, '2025-26', 3, 15, 3, v_t3, v_t3, '88430c45-914d-44f1-95cc-8fade3de4c5b', now()),  -- Siakam
    (v_league_id, v_draft_id, '2025-26', 3, 16, 4, v_t4, v_t4, '7413ffb9-f05e-4687-b79a-a20678282f04', now()),  -- Avdija
    (v_league_id, v_draft_id, '2025-26', 3, 17, 5, v_t5, v_t5, '473e53cc-c6e5-410a-9ce0-ca1727c789a4', now()),  -- Wembanyama
    (v_league_id, v_draft_id, '2025-26', 3, 18, 6, v_t6, v_t6, 'ef872c6e-270f-4b5f-a34d-73edb21cb4d0', now()),  -- Knueppel
    -- Round 4 (reversed)
    (v_league_id, v_draft_id, '2025-26', 4, 19, 6, v_t6, v_t6, '1e1f0e9a-76c4-4907-a0cd-ec7ce266f50d', now()),  -- KAT
    (v_league_id, v_draft_id, '2025-26', 4, 20, 5, v_t5, v_t5, 'a4f7fea7-5e8d-4572-b892-7970049c8931', now()),  -- LeBron
    (v_league_id, v_draft_id, '2025-26', 4, 21, 4, v_t4, v_t4, '2572f534-e2ce-4dd4-a460-7e752bf83144', now()),  -- Sengun
    (v_league_id, v_draft_id, '2025-26', 4, 22, 3, v_t3, v_t3, 'd940f3c6-57f7-44a8-b765-bcdc7d6cfc9a', now()),  -- Scottie Barnes
    (v_league_id, v_draft_id, '2025-26', 4, 23, 2, v_t2, v_t2, 'eeaab802-8c13-47ed-a6cb-bfa8f4e69d8e', now()),  -- De'Aaron Fox
    (v_league_id, v_draft_id, '2025-26', 4, 24, 1, v_t1, v_t1, 'd53ed4c0-a34e-409e-bb3c-a35d7cb0e63c', now()),  -- Bam Adebayo
    -- Round 5
    (v_league_id, v_draft_id, '2025-26', 5, 25, 1, v_t1, v_t1, 'cebdb6e2-00d2-4519-b072-97301601f07f', now()),  -- Harden
    (v_league_id, v_draft_id, '2025-26', 5, 26, 2, v_t2, v_t2, '08a8c467-c601-4eb6-bbb3-a4558f0806c5', now()),  -- Amen Thompson
    (v_league_id, v_draft_id, '2025-26', 5, 27, 3, v_t3, v_t3, '8757cb88-2ea3-430e-8b82-260dcd14a1e6', now()),  -- Cooper Flagg
    (v_league_id, v_draft_id, '2025-26', 5, 28, 4, v_t4, v_t4, '937346b1-0e32-47f4-9448-1a9629d6a224', now()),  -- LaMelo Ball
    (v_league_id, v_draft_id, '2025-26', 5, 29, 5, v_t5, v_t5, 'd6dcf1ba-3918-4f14-924c-01aa2d35be6c', now()),  -- CJ McCollum
    (v_league_id, v_draft_id, '2025-26', 5, 30, 6, v_t6, v_t6, 'b2e4fd7c-4d83-4a54-8aca-54a71f2e7269', now()),  -- Payton Pritchard
    -- Round 6 (reversed)
    (v_league_id, v_draft_id, '2025-26', 6, 31, 6, v_t6, v_t6, '4b51e55d-1eed-48b8-a0cb-4849d23c6d72', now()),  -- Zion
    (v_league_id, v_draft_id, '2025-26', 6, 32, 5, v_t5, v_t5, '3a3356cd-0447-4b90-8a9f-53c776e92d42', now()),  -- Buzelis
    (v_league_id, v_draft_id, '2025-26', 6, 33, 4, v_t4, v_t4, 'fcf22216-9800-47dd-abb1-04de5fab4595', now()),  -- Miles Bridges
    (v_league_id, v_draft_id, '2025-26', 6, 34, 3, v_t3, v_t3, '823a869d-05e1-4e7b-9216-f107eb76b4ac', now()),  -- Evan Mobley
    (v_league_id, v_draft_id, '2025-26', 6, 35, 2, v_t2, v_t2, '8b9c386c-07d8-40df-aa6d-704a97f07d51', now()),  -- Saddiq Bey
    (v_league_id, v_draft_id, '2025-26', 6, 36, 1, v_t1, v_t1, '3f1bd00f-e817-4639-b6bf-1b6e73997393', now()),  -- Brandon Miller
    -- Round 7
    (v_league_id, v_draft_id, '2025-26', 7, 37, 1, v_t1, v_t1, 'd3dcc1e9-8171-4fa9-980b-96de346397c6', now()),  -- Austin Reaves
    (v_league_id, v_draft_id, '2025-26', 7, 38, 2, v_t2, v_t2, 'c30ddb38-ab64-4384-82ea-d5bcc9f5fdaf', now()),  -- Coby White
    (v_league_id, v_draft_id, '2025-26', 7, 39, 3, v_t3, v_t3, '69843219-f388-4e77-bc91-7a8856193168', now()),  -- Jabari Smith Jr.
    (v_league_id, v_draft_id, '2025-26', 7, 40, 4, v_t4, v_t4, '083b1c9d-66f5-4012-9491-79247ad6e8a5', now()),  -- Chet Holmgren
    (v_league_id, v_draft_id, '2025-26', 7, 41, 5, v_t5, v_t5, 'c9c13181-33d4-4637-99fa-7c94676dd38d', now()),  -- VJ Edgecombe
    (v_league_id, v_draft_id, '2025-26', 7, 42, 6, v_t6, v_t6, 'cdac1109-0e34-4f07-b9e3-7f70c12fcea6', now()),  -- Mikal Bridges
    -- Round 8 (reversed)
    (v_league_id, v_draft_id, '2025-26', 8, 43, 6, v_t6, v_t6, 'd835346b-9432-4929-bff3-4a6843c182d7', now()),  -- OG Anunoby
    (v_league_id, v_draft_id, '2025-26', 8, 44, 5, v_t5, v_t5, 'd6b9ede0-685a-4133-9287-6382ea0d37c1', now()),  -- DaQuan Jeffries
    (v_league_id, v_draft_id, '2025-26', 8, 45, 4, v_t4, v_t4, '04c2d06e-5e48-446b-b111-41d454d6d3ca', now()),  -- Tyler Herro
    (v_league_id, v_draft_id, '2025-26', 8, 46, 3, v_t3, v_t3, '8a5818d6-2f1b-4932-8720-72f89701acfc', now()),  -- Josh Giddey
    (v_league_id, v_draft_id, '2025-26', 8, 47, 2, v_t2, v_t2, 'bcc1831c-a5de-49bf-a443-2ad9350112ad', now()),  -- Stephon Castle
    (v_league_id, v_draft_id, '2025-26', 8, 48, 1, v_t1, v_t1, '13c73820-679b-480b-8902-4200c3bdcea5', now()),  -- Tim Hardaway Jr.
    -- Round 9
    (v_league_id, v_draft_id, '2025-26', 9, 49, 1, v_t1, v_t1, '30ca15c1-2610-4c83-894b-e07d6fbf73be', now()),  -- Scoot Henderson
    (v_league_id, v_draft_id, '2025-26', 9, 50, 2, v_t2, v_t2, '55a5939c-ec04-4405-834a-17d76f77be96', now()),  -- Reed Sheppard
    (v_league_id, v_draft_id, '2025-26', 9, 51, 3, v_t3, v_t3, '8e206e68-2647-4436-b52d-d460d166189f', now()),  -- Brandin Podziemski
    (v_league_id, v_draft_id, '2025-26', 9, 52, 4, v_t4, v_t4, '272cbe6a-b50b-46a4-974a-0613c9c1a072', now()),  -- Porzingis
    (v_league_id, v_draft_id, '2025-26', 9, 53, 5, v_t5, v_t5, '534e97d5-a4fe-4d46-a763-8a8c43fe0710', now()),  -- Andrew Nembhard
    (v_league_id, v_draft_id, '2025-26', 9, 54, 6, v_t6, v_t6, '6136e3c8-5839-445d-99fe-1c8d845fa58e', now()),  -- Toumani Camara
    -- Round 10 (reversed)
    (v_league_id, v_draft_id, '2025-26', 10, 55, 6, v_t6, v_t6, '1d345181-52ff-4800-b579-0203e3c3542c', now()),  -- Jeremiah Fears
    (v_league_id, v_draft_id, '2025-26', 10, 56, 5, v_t5, v_t5, 'cefb61ec-8561-4c58-9ae8-76b3d84d3d45', now()),  -- Collin Gillespie
    (v_league_id, v_draft_id, '2025-26', 10, 57, 4, v_t4, v_t4, '7b3fda82-8074-4bfa-a955-a9a02423e4f0', now()),  -- Keldon Johnson
    (v_league_id, v_draft_id, '2025-26', 10, 58, 3, v_t3, v_t3, 'e944234a-1e6b-438c-b104-aae33c0929d1', now()),  -- RJ Barrett
    (v_league_id, v_draft_id, '2025-26', 10, 59, 2, v_t2, v_t2, '94db0ea3-cb9c-4b19-af49-cef13ef37d2b', now()),  -- Quentin Grimes
    (v_league_id, v_draft_id, '2025-26', 10, 60, 1, v_t1, v_t1, '3f0cef11-4dee-40f6-b4ef-1fee73ae139b', now()),  -- Cam Thomas
    -- Round 11
    (v_league_id, v_draft_id, '2025-26', 11, 61, 1, v_t1, v_t1, 'd7204405-ebc7-4355-9ff3-7ef368926088', now()),  -- Donte DiVincenzo
    (v_league_id, v_draft_id, '2025-26', 11, 62, 2, v_t2, v_t2, 'bc96442e-a114-4e61-aaf3-322535cbfe53', now()),  -- Tre Jones
    (v_league_id, v_draft_id, '2025-26', 11, 63, 3, v_t3, v_t3, 'a604bb9c-a6a4-4a3f-958e-df95ba58df27', now()),  -- Ace Bailey
    (v_league_id, v_draft_id, '2025-26', 11, 64, 4, v_t4, v_t4, 'a3d95b31-265f-4d56-bb42-6bcfceb31f8b', now()),  -- Max Christie
    (v_league_id, v_draft_id, '2025-26', 11, 65, 5, v_t5, v_t5, '1ff3b745-48c7-40f4-a7e2-948dd2a12d95', now()),  -- Collin Sexton
    (v_league_id, v_draft_id, '2025-26', 11, 66, 6, v_t6, v_t6, '164e0b6a-9dc6-4b43-895c-f2a379d849aa', now()),  -- Donovan Clingan
    -- Round 12 (reversed)
    (v_league_id, v_draft_id, '2025-26', 12, 67, 6, v_t6, v_t6, '75362e39-db7f-4192-98bc-b8fd0fb687ed', now()),  -- Ajay Mitchell
    (v_league_id, v_draft_id, '2025-26', 12, 68, 5, v_t5, v_t5, 'd37c0741-0bad-452b-bd45-6602e4d9dda5', now()),  -- John Collins
    (v_league_id, v_draft_id, '2025-26', 12, 69, 4, v_t4, v_t4, '56e25e4c-d17a-4fe5-a59d-89fc068613aa', now()),  -- Dejounte Murray
    (v_league_id, v_draft_id, '2025-26', 12, 70, 3, v_t3, v_t3, '3895adb2-6144-4da5-b529-b7547f2fe85c', now()),  -- Derik Queen
    (v_league_id, v_draft_id, '2025-26', 12, 71, 2, v_t2, v_t2, 'd244d4b3-2b6e-4596-a405-84f519e4e1f8', now()),  -- Grayson Allen
    (v_league_id, v_draft_id, '2025-26', 12, 72, 1, v_t1, v_t1, '76d23f1c-1e96-43b3-a52d-7552d2cfcfcb', now()),  -- Devin Vassell
    -- Round 13
    (v_league_id, v_draft_id, '2025-26', 13, 73, 1, v_t1, v_t1, '6aa881a4-01a8-4c0c-b720-4a84ae73ddb7', now()),  -- Wendell Carter Jr.
    (v_league_id, v_draft_id, '2025-26', 13, 74, 2, v_t2, v_t2, '50f0f699-6e29-474b-8511-5205ad373e10', now()),  -- Alondes Williams
    (v_league_id, v_draft_id, '2025-26', 13, 75, 3, v_t3, v_t3, 'c13c19c5-d17f-438b-b379-67cb21fa4f43', now()),  -- Deandre Ayton
    (v_league_id, v_draft_id, '2025-26', 13, 76, 4, v_t4, v_t4, '7c6ad340-09c8-4e21-8c14-d7a3d2342f75', now()),  -- Julian Champagnie
    (v_league_id, v_draft_id, '2025-26', 13, 77, 5, v_t5, v_t5, 'dad6b424-5835-432e-a01c-570529e21a5a', now()),  -- Nic Claxton
    (v_league_id, v_draft_id, '2025-26', 13, 78, 6, v_t6, v_t6, 'aa5f4fc9-1aef-4ea9-96b4-ba99d9b17b8c', now()); -- Mamukelashvili

  -----------------------------------------------------------------
  -- 6. LEAGUE_PLAYERS (roster assignments)
  --    Slots: PG, SG, SF, PF, C, G, F, UTIL, UTIL, UTIL, BE, BE, BE
  -----------------------------------------------------------------

  -- Team 1 (Spoels): SGA, J.Johnson, NAW, Bam, Harden, B.Miller, Reaves, Hardaway, Scoot, Cam Thomas, DiVincenzo, Vassell, WCJ
  INSERT INTO league_players (league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at) VALUES
    (v_league_id, v_t1, 'd50eaf07-b314-4e0f-be90-90f618e1cd08', 'PG',     'PG',   'draft', now()),  -- SGA
    (v_league_id, v_t1, '13c73820-679b-480b-8902-4200c3bdcea5', 'SG',     'SG',   'draft', now()),  -- Hardaway Jr
    (v_league_id, v_t1, '0ba2aa96-e358-4a65-a1ee-c26eeea61d64', 'SF-SG',  'SF',   'draft', now()),  -- NAW
    (v_league_id, v_t1, '2da678ce-5e57-4791-9426-a8c94aa51bf2', 'PF-SF',  'PF',   'draft', now()),  -- Jalen Johnson
    (v_league_id, v_t1, 'd53ed4c0-a34e-409e-bb3c-a35d7cb0e63c', 'C-PF',   'C',    'draft', now()),  -- Bam
    (v_league_id, v_t1, 'cebdb6e2-00d2-4519-b072-97301601f07f', 'PG-SG',  'G',    'draft', now()),  -- Harden
    (v_league_id, v_t1, '3f1bd00f-e817-4639-b6bf-1b6e73997393', 'SF-SG',  'F',    'draft', now()),  -- Brandon Miller
    (v_league_id, v_t1, 'd3dcc1e9-8171-4fa9-980b-96de346397c6', 'PG-SF-SG','UTIL','draft', now()),  -- Austin Reaves
    (v_league_id, v_t1, '3f0cef11-4dee-40f6-b4ef-1fee73ae139b', 'SG',     'UTIL', 'draft', now()),  -- Cam Thomas
    (v_league_id, v_t1, '30ca15c1-2610-4c83-894b-e07d6fbf73be', 'PG',     'UTIL', 'draft', now()),  -- Scoot Henderson
    (v_league_id, v_t1, 'd7204405-ebc7-4355-9ff3-7ef368926088', 'PG-SF-SG','BE',  'draft', now()),  -- DiVincenzo
    (v_league_id, v_t1, '76d23f1c-1e96-43b3-a52d-7552d2cfcfcb', 'SF-SG',  'BE',   'draft', now()),  -- Vassell
    (v_league_id, v_t1, '6aa881a4-01a8-4c0c-b720-4a84ae73ddb7', 'C',      'BE',   'draft', now());  -- WCJ

  -- Team 2 (Noah): KD, Booker, Banchero, Fox, Amen, Saddiq Bey, Coby White, Castle, Sheppard, Grimes, Tre Jones, G.Allen, Alondes Williams
  INSERT INTO league_players (league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at) VALUES
    (v_league_id, v_t2, 'eeaab802-8c13-47ed-a6cb-bfa8f4e69d8e', 'PG',       'PG',   'draft', now()),  -- Fox
    (v_league_id, v_t2, '74900e13-e57c-4ceb-8151-74696055047f', 'PG-SG',    'SG',   'draft', now()),  -- Booker
    (v_league_id, v_t2, 'f7909beb-3309-4b4d-a2eb-d3218d42988c', 'PF-SF',    'SF',   'draft', now()),  -- KD
    (v_league_id, v_t2, '1051c5c6-2682-4a7a-a0a1-2c8aa80213d4', 'PF-SF',    'PF',   'draft', now()),  -- Banchero
    (v_league_id, v_t2, '8b9c386c-07d8-40df-aa6d-704a97f07d51', 'PF-SF',    'C',    'draft', now()),  -- Saddiq Bey (no C but filling)
    (v_league_id, v_t2, '08a8c467-c601-4eb6-bbb3-a4558f0806c5', 'PG-SF-SG', 'G',    'draft', now()),  -- Amen Thompson
    (v_league_id, v_t2, 'd244d4b3-2b6e-4596-a405-84f519e4e1f8', 'SF-SG',    'F',    'draft', now()),  -- Grayson Allen
    (v_league_id, v_t2, 'c30ddb38-ab64-4384-82ea-d5bcc9f5fdaf', 'PG-SG',    'UTIL', 'draft', now()),  -- Coby White
    (v_league_id, v_t2, 'bcc1831c-a5de-49bf-a443-2ad9350112ad', 'PG-SG',    'UTIL', 'draft', now()),  -- Castle
    (v_league_id, v_t2, '55a5939c-ec04-4405-834a-17d76f77be96', 'PG-SG',    'UTIL', 'draft', now()),  -- Sheppard
    (v_league_id, v_t2, '94db0ea3-cb9c-4b19-af49-cef13ef37d2b', 'PG-SG',    'BE',   'draft', now()),  -- Grimes
    (v_league_id, v_t2, 'bc96442e-a114-4e61-aaf3-322535cbfe53', 'PG-SF-SG', 'BE',   'draft', now()),  -- Tre Jones
    (v_league_id, v_t2, '50f0f699-6e29-474b-8511-5205ad373e10', 'PG-SG',    'BE',   'draft', now());  -- Alondes Williams

  -- Team 3 (Goldman): Mitchell, Bane, Siakam, Barnes, Flagg, Mobley, Jabari Smith, Giddey, Podziemski, RJ Barrett, Ace Bailey, Derik Queen, Ayton
  INSERT INTO league_players (league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at) VALUES
    (v_league_id, v_t3, 'e4de86d0-cd56-4810-b2e2-4d41b835d790', 'PG-SG',    'PG',   'draft', now()),  -- Mitchell
    (v_league_id, v_t3, '8e2d5184-9b01-49a3-81f1-304816e56211', 'PG-SF-SG', 'SG',   'draft', now()),  -- Bane
    (v_league_id, v_t3, '8757cb88-2ea3-430e-8b82-260dcd14a1e6', 'PG-SF-PF', 'SF',   'draft', now()),  -- Cooper Flagg
    (v_league_id, v_t3, '88430c45-914d-44f1-95cc-8fade3de4c5b', 'PF-SF',    'PF',   'draft', now()),  -- Siakam
    (v_league_id, v_t3, '823a869d-05e1-4e7b-9216-f107eb76b4ac', 'C-PF',     'C',    'draft', now()),  -- Mobley
    (v_league_id, v_t3, '8a5818d6-2f1b-4932-8720-72f89701acfc', 'PG',       'G',    'draft', now()),  -- Giddey
    (v_league_id, v_t3, 'd940f3c6-57f7-44a8-b765-bcdc7d6cfc9a', 'PF-SF',    'F',    'draft', now()),  -- Scottie Barnes
    (v_league_id, v_t3, '69843219-f388-4e77-bc91-7a8856193168', 'C-PF',     'UTIL', 'draft', now()),  -- Jabari Smith Jr.
    (v_league_id, v_t3, 'e944234a-1e6b-438c-b104-aae33c0929d1', 'PF-SF-SG', 'UTIL', 'draft', now()),  -- RJ Barrett
    (v_league_id, v_t3, '8e206e68-2647-4436-b52d-d460d166189f', 'PG-SG',    'UTIL', 'draft', now()),  -- Podziemski
    (v_league_id, v_t3, 'a604bb9c-a6a4-4a3f-958e-df95ba58df27', 'PG-SF-SG', 'BE',   'draft', now()),  -- Ace Bailey
    (v_league_id, v_t3, '3895adb2-6144-4da5-b529-b7547f2fe85c', 'C-PF',     'BE',   'draft', now()),  -- Derik Queen
    (v_league_id, v_t3, 'c13c19c5-d17f-438b-b379-67cb21fa4f43', 'C',        'BE',   'draft', now());  -- Ayton

  -- Team 4 (Church): Maxey, Randle, Avdija, Sengun, LaMelo, Miles Bridges, Chet, Herro, Porzingis, Keldon, Max Christie, Dejounte, Champagnie
  INSERT INTO league_players (league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at) VALUES
    (v_league_id, v_t4, 'aa17549f-2ddf-492c-b1bb-427a5dbec678', 'PG',       'PG',   'draft', now()),  -- Maxey
    (v_league_id, v_t4, 'a3d95b31-265f-4d56-bb42-6bcfceb31f8b', 'SF-SG',    'SG',   'draft', now()),  -- Max Christie
    (v_league_id, v_t4, '7413ffb9-f05e-4687-b79a-a20678282f04', 'PF-SF-SG', 'SF',   'draft', now()),  -- Avdija
    (v_league_id, v_t4, '14914116-c9cf-4b32-9590-fb9b112378f5', 'PF',       'PF',   'draft', now()),  -- Randle
    (v_league_id, v_t4, '2572f534-e2ce-4dd4-a460-7e752bf83144', 'C',        'C',    'draft', now()),  -- Sengun
    (v_league_id, v_t4, '937346b1-0e32-47f4-9448-1a9629d6a224', 'PG',       'G',    'draft', now()),  -- LaMelo
    (v_league_id, v_t4, 'fcf22216-9800-47dd-abb1-04de5fab4595', 'PF-SF',    'F',    'draft', now()),  -- Miles Bridges
    (v_league_id, v_t4, '083b1c9d-66f5-4012-9491-79247ad6e8a5', 'PF-C',     'UTIL', 'draft', now()),  -- Chet
    (v_league_id, v_t4, '04c2d06e-5e48-446b-b111-41d454d6d3ca', 'PG-SG',    'UTIL', 'draft', now()),  -- Herro
    (v_league_id, v_t4, '272cbe6a-b50b-46a4-974a-0613c9c1a072', 'C',        'UTIL', 'draft', now()),  -- Porzingis
    (v_league_id, v_t4, '7b3fda82-8074-4bfa-a955-a9a02423e4f0', 'PF-SF',    'BE',   'draft', now()),  -- Keldon Johnson
    (v_league_id, v_t4, '56e25e4c-d17a-4fe5-a59d-89fc068613aa', 'PG',       'BE',   'draft', now()),  -- Dejounte Murray
    (v_league_id, v_t4, '7c6ad340-09c8-4e21-8c14-d7a3d2342f75', 'SF-SG',    'BE',   'draft', now());  -- Champagnie

  -- Team 5 (Engelhardt): Brunson, Jokic, Wemby, LeBron, CJ McCollum, Buzelis, VJ Edgecombe, DaQuan Jeffries, Nembhard, Gillespie, Sexton, J.Collins, Claxton
  INSERT INTO league_players (league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at) VALUES
    (v_league_id, v_t5, '6f21e902-f378-4a25-a2ab-15c8bc3f2c19', 'PG',       'PG',   'draft', now()),  -- Brunson
    (v_league_id, v_t5, 'd6dcf1ba-3918-4f14-924c-01aa2d35be6c', 'PG-SG',    'SG',   'draft', now()),  -- CJ McCollum
    (v_league_id, v_t5, 'a4f7fea7-5e8d-4572-b892-7970049c8931', 'PF-SF',    'SF',   'draft', now()),  -- LeBron
    (v_league_id, v_t5, '3a3356cd-0447-4b90-8a9f-53c776e92d42', 'PF-SF',    'PF',   'draft', now()),  -- Buzelis
    (v_league_id, v_t5, '53ba47f0-7121-4740-af77-6ade8ba807af', 'C',        'C',    'draft', now()),  -- Jokic
    (v_league_id, v_t5, '1ff3b745-48c7-40f4-a7e2-948dd2a12d95', 'PG-SG',    'G',    'draft', now()),  -- Collin Sexton
    (v_league_id, v_t5, 'd6b9ede0-685a-4133-9287-6382ea0d37c1', 'F',        'F',    'draft', now()),  -- DaQuan Jeffries
    (v_league_id, v_t5, '473e53cc-c6e5-410a-9ce0-ca1727c789a4', 'C',        'UTIL', 'draft', now()),  -- Wembanyama
    (v_league_id, v_t5, 'c9c13181-33d4-4637-99fa-7c94676dd38d', 'PG-SG',    'UTIL', 'draft', now()),  -- VJ Edgecombe
    (v_league_id, v_t5, '534e97d5-a4fe-4d46-a763-8a8c43fe0710', 'PG-SG',    'UTIL', 'draft', now()),  -- Nembhard
    (v_league_id, v_t5, 'cefb61ec-8561-4c58-9ae8-76b3d84d3d45', 'PG-SG',    'BE',   'draft', now()),  -- Gillespie
    (v_league_id, v_t5, 'd37c0741-0bad-452b-bd45-6602e4d9dda5', 'C-PF',     'BE',   'draft', now()),  -- John Collins
    (v_league_id, v_t5, 'dad6b424-5835-432e-a01c-570529e21a5a', 'C-PF',     'BE',   'draft', now());  -- Nic Claxton

  -- Team 6 (Proton): J.Murray, Kawhi, Knueppel, KAT, Pritchard, Zion, Mikal Bridges, OG, Camara, Fears, Clingan, Ajay Mitchell, Mamukelashvili
  INSERT INTO league_players (league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at) VALUES
    (v_league_id, v_t6, 'bb2764ff-7d0d-48a2-88be-4146d47800a1', 'PG-SG',    'PG',   'draft', now()),  -- Jamal Murray
    (v_league_id, v_t6, 'ef872c6e-270f-4b5f-a34d-73edb21cb4d0', 'PG-SF-SG', 'SG',   'draft', now()),  -- Knueppel
    (v_league_id, v_t6, '9ca0d830-ae6c-4561-87f6-226124a6e74a', 'PF-SF',    'SF',   'draft', now()),  -- Kawhi
    (v_league_id, v_t6, '4b51e55d-1eed-48b8-a0cb-4849d23c6d72', 'PF',       'PF',   'draft', now()),  -- Zion
    (v_league_id, v_t6, '1e1f0e9a-76c4-4907-a0cd-ec7ce266f50d', 'C-PF',     'C',    'draft', now()),  -- KAT
    (v_league_id, v_t6, 'b2e4fd7c-4d83-4a54-8aca-54a71f2e7269', 'PG',       'G',    'draft', now()),  -- Pritchard
    (v_league_id, v_t6, 'cdac1109-0e34-4f07-b9e3-7f70c12fcea6', 'PF-SF-SG', 'F',    'draft', now()),  -- Mikal Bridges
    (v_league_id, v_t6, 'd835346b-9432-4929-bff3-4a6843c182d7', 'PF-SF',    'UTIL', 'draft', now()),  -- OG
    (v_league_id, v_t6, '6136e3c8-5839-445d-99fe-1c8d845fa58e', 'PF-SF-SG', 'UTIL', 'draft', now()),  -- Camara
    (v_league_id, v_t6, '75362e39-db7f-4192-98bc-b8fd0fb687ed', 'PG-SG',    'UTIL', 'draft', now()),  -- Ajay Mitchell
    (v_league_id, v_t6, '1d345181-52ff-4800-b579-0203e3c3542c', 'PG-SG',    'BE',   'draft', now()),  -- Fears
    (v_league_id, v_t6, '164e0b6a-9dc6-4b43-895c-f2a379d849aa', 'C',        'BE',   'draft', now()),  -- Clingan
    (v_league_id, v_t6, 'aa5f4fc9-1aef-4ea9-96b4-ba99d9b17b8c', 'C-PF',     'BE',   'draft', now());  -- Mamukelashvili

  -----------------------------------------------------------------
  -- 7. SCHEDULE (2 weeks, Mon-Sun)
  --    Week 1: 2026-03-30 (Mon) to 2026-04-05 (Sun)
  --    Week 2: 2026-04-06 (Mon) to 2026-04-12 (Sun)
  -----------------------------------------------------------------
  INSERT INTO league_schedule (league_id, season, week_number, start_date, end_date, is_playoff)
  VALUES (v_league_id, '2025-26', 1, '2026-03-30', '2026-04-05', false)
  RETURNING id INTO v_sched1;

  INSERT INTO league_schedule (league_id, season, week_number, start_date, end_date, is_playoff)
  VALUES (v_league_id, '2025-26', 2, '2026-04-06', '2026-04-12', false)
  RETURNING id INTO v_sched2;

  -----------------------------------------------------------------
  -- 8. MATCHUPS (Berger round-robin, 6 teams)
  --    Round 1: T1vT6, T2vT5, T3vT4
  --    Round 2: T1vT5, T6vT4, T2vT3
  -----------------------------------------------------------------
  INSERT INTO league_matchups (league_id, schedule_id, week_number, home_team_id, away_team_id) VALUES
    -- Week 1
    (v_league_id, v_sched1, 1, v_t1, v_t6),
    (v_league_id, v_sched1, 1, v_t2, v_t5),
    (v_league_id, v_sched1, 1, v_t3, v_t4),
    -- Week 2
    (v_league_id, v_sched2, 2, v_t1, v_t5),
    (v_league_id, v_sched2, 2, v_t6, v_t4),
    (v_league_id, v_sched2, 2, v_t2, v_t3);

  RAISE NOTICE '✅ CAT Test League seeded!';
  RAISE NOTICE 'League: %', v_league_id;
  RAISE NOTICE 'Teams: % (Spoels), % (Noah), % (Goldman), % (Church), % (Engelhardt), % (Proton)', v_t1, v_t2, v_t3, v_t4, v_t5, v_t6;
  RAISE NOTICE 'Draft: %', v_draft_id;
END $$;
