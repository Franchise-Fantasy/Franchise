-- Preserve the ORIGINAL protection_owner_id when a protected pick is traded
-- a second time. The previous CASE assigned `from_team_id` of the current
-- trade, so a chain like A → B → C (both legs protected) ended up with
-- protection_owner_id = B, and the lottery resolution then announced
-- "B kept their protected pick" when it should say "A kept their protected pick".
-- The protection owner is set once (when protection is first applied) and is
-- structurally locked from that point on — only `reverse-trade` can clear it.

CREATE OR REPLACE FUNCTION execute_trade_transfers(
  p_league_id       uuid,
  p_proposal_id     uuid,
  p_proposed_by     uuid,
  p_timestamp       timestamptz,
  p_today           date,
  p_week_start      date,
  p_player_moves    jsonb,
  p_pick_moves      jsonb,
  p_pick_swaps      jsonb,
  p_notes           text,
  p_drops           jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move      jsonb;
  v_pid       uuid;
  v_from      uuid;
  v_to        uuid;
  v_slot      text;
  v_pre_slot  text;
  v_snap_dt   date;
  v_pick      jsonb;
  v_drop      jsonb;
  v_drop_team uuid;
  v_drop_pid  uuid;
  v_drop_slot text;
  v_drop_acq  timestamptz;
  v_txn_id    uuid;
  v_prot      int;
BEGIN
  -- 0. Process drops FIRST so the roster has room for incoming players.
  FOR v_drop IN SELECT * FROM jsonb_array_elements(p_drops)
  LOOP
    v_drop_team := (v_drop->>'team_id')::uuid;
    v_drop_pid  := (v_drop->>'player_id')::uuid;

    DELETE FROM league_players
    WHERE league_id = p_league_id
      AND team_id   = v_drop_team
      AND player_id = v_drop_pid
    RETURNING roster_slot, acquired_at
    INTO v_drop_slot, v_drop_acq;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Drop target player % is no longer on team %. Trade cannot be completed.',
        v_drop_pid, v_drop_team;
    END IF;

    IF p_week_start IS NOT NULL THEN
      v_snap_dt := GREATEST(p_week_start, COALESCE(v_drop_acq::date, p_week_start));
      IF v_snap_dt < p_today THEN
        INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
        VALUES (p_league_id, v_drop_team, v_drop_pid, v_snap_dt, COALESCE(v_drop_slot, 'BE'))
        ON CONFLICT (team_id, player_id, lineup_date) DO NOTHING;
      END IF;
    END IF;

    INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    VALUES (p_league_id, v_drop_team, v_drop_pid, p_today, 'DROPPED')
    ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'DROPPED';

    DELETE FROM daily_lineups
    WHERE league_id   = p_league_id
      AND team_id     = v_drop_team
      AND player_id   = v_drop_pid
      AND lineup_date > p_today;

    IF (v_drop->>'waiver_until') IS NOT NULL THEN
      INSERT INTO league_waivers (league_id, player_id, on_waivers_until, dropped_by_team_id)
      VALUES (p_league_id, v_drop_pid, (v_drop->>'waiver_until')::timestamptz, v_drop_team);
    END IF;
  END LOOP;

  -- 1. Transfer players
  FOR v_move IN SELECT * FROM jsonb_array_elements(p_player_moves)
  LOOP
    v_pid      := (v_move->>'player_id')::uuid;
    v_from     := (v_move->>'from_team_id')::uuid;
    v_to       := (v_move->>'to_team_id')::uuid;
    v_slot     := COALESCE(v_move->>'target_slot', 'BE');
    v_pre_slot := COALESCE(v_move->>'pre_trade_slot', 'BE');

    UPDATE league_players
    SET team_id      = v_to,
        acquired_via = 'trade',
        acquired_at  = p_timestamp,
        roster_slot  = v_slot
    WHERE league_id = p_league_id
      AND player_id = v_pid
      AND team_id   = v_from;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Player % is no longer on team %. Trade cannot be completed.', v_pid, v_from;
    END IF;

    IF p_week_start IS NOT NULL THEN
      v_snap_dt := CASE WHEN p_week_start = p_today THEN p_today - 1 ELSE p_week_start END;
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, v_from, v_pid, v_snap_dt, v_pre_slot)
      ON CONFLICT (team_id, player_id, lineup_date) DO NOTHING;
    END IF;

    INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    VALUES (p_league_id, v_from, v_pid, p_today, 'DROPPED')
    ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'DROPPED';

    DELETE FROM daily_lineups
    WHERE league_id   = p_league_id
      AND team_id     = v_from
      AND player_id   = v_pid
      AND lineup_date > p_today;

    INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    VALUES (p_league_id, v_to, v_pid, p_today, v_slot)
    ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = excluded.roster_slot;
  END LOOP;

  -- 2. Clear trade block status for all traded players
  UPDATE league_players
  SET on_trade_block    = false,
      trade_block_note  = null,
      trade_block_interest = '{}'::uuid[]
  WHERE league_id = p_league_id
    AND player_id IN (
      SELECT (j->>'player_id')::uuid FROM jsonb_array_elements(p_player_moves) j
    );

  -- 3. Transfer draft picks. protection_owner_id is set ONLY the first time
  --    a protection is applied to a pick (when it was previously null), so a
  --    re-trade of an already-protected pick keeps pointing at the true
  --    original owner instead of an intermediate holder.
  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_pick_moves)
  LOOP
    v_prot := (v_pick->>'protection_threshold')::int;

    UPDATE draft_picks
    SET current_team_id      = (v_pick->>'to_team_id')::uuid,
        protection_threshold = COALESCE(v_prot, protection_threshold),
        protection_owner_id  = CASE
                                 WHEN v_prot IS NOT NULL AND protection_owner_id IS NULL
                                   THEN (v_pick->>'from_team_id')::uuid
                                 ELSE protection_owner_id
                               END
    WHERE id = (v_pick->>'draft_pick_id')::uuid;
  END LOOP;

  -- 4. Insert pick swaps
  IF jsonb_array_length(COALESCE(p_pick_swaps, '[]'::jsonb)) > 0 THEN
    INSERT INTO pick_swaps (league_id, season, round, beneficiary_team_id, counterparty_team_id, created_by_proposal_id)
    SELECT p_league_id,
           j->>'season',
           (j->>'round')::int,
           (j->>'beneficiary_team_id')::uuid,
           (j->>'counterparty_team_id')::uuid,
           p_proposal_id
    FROM jsonb_array_elements(p_pick_swaps) j;
  END IF;

  -- 5. Create transaction record
  INSERT INTO league_transactions (league_id, type, notes, team_id)
  VALUES (p_league_id, 'trade', p_notes, p_proposed_by)
  RETURNING id INTO v_txn_id;

  -- 6. Create transaction items (players + picks)
  INSERT INTO league_transaction_items (transaction_id, player_id, draft_pick_id, team_from_id, team_to_id)
  SELECT v_txn_id,
         (j->>'player_id')::uuid,
         null,
         (j->>'from_team_id')::uuid,
         (j->>'to_team_id')::uuid
  FROM jsonb_array_elements(p_player_moves) j;

  INSERT INTO league_transaction_items (transaction_id, player_id, draft_pick_id, team_from_id, team_to_id)
  SELECT v_txn_id,
         null,
         (j->>'draft_pick_id')::uuid,
         (j->>'from_team_id')::uuid,
         (j->>'to_team_id')::uuid
  FROM jsonb_array_elements(p_pick_moves) j;

  -- 7. Mark proposal as completed
  UPDATE trade_proposals
  SET status         = 'completed',
      completed_at   = p_timestamp,
      transaction_id = v_txn_id
  WHERE id = p_proposal_id;

  RETURN v_txn_id;
END;
$$;
