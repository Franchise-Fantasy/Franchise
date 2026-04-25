-- Atomic trade acceptance + atomic drop processing.
--
-- Two bugs fixed here:
--
-- 1) Double-accept race. The old client flow did:
--      UPDATE trade_proposal_teams SET status='accepted' WHERE team=me;
--      SELECT status FROM trade_proposal_teams WHERE proposal=...;   -- unlocked read
--      if all accepted -> transition proposal + invoke execute-trade.
--    Two teams tapping Accept near-simultaneously could each see their own write
--    but miss the other's, so neither triggered execute-trade and the proposal
--    silently stayed in 'accepted' / 'pending' with no transaction_id.
--    `accept_trade_proposal` below moves the entire accept+check+transition into
--    a single transaction with SELECT ... FOR UPDATE on the proposal row, so
--    concurrent accepts serialize and exactly one caller observes all-accepted.
--
-- 2) Drop idempotency + ownership. `execute_trade_transfers` now takes `p_drops`
--    and processes them inside the same transaction as the player transfers.
--    Ownership is enforced by the DELETE's team_id clause + RETURNING/NOT FOUND,
--    so a stale drop target can't silently no-op. Because the RPC only runs once
--    (protected by the `transaction_id IS NOT NULL` idempotency check in the
--    edge function), there's no longer a path that double-drops a player or
--    double-inserts into league_waivers.

-- ---------------------------------------------------------------------------
-- 1. accept_trade_proposal: atomic accept + all-accepted check + transition
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accept_trade_proposal(
  p_proposal_id     uuid,
  p_team_id         uuid,
  p_drop_player_ids uuid[],
  p_veto_type       text,          -- 'none' | 'commissioner' | 'league_vote'
  p_review_hours    int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal     trade_proposals%ROWTYPE;
  v_accepted     int;
  v_total        int;
  v_all_accepted boolean;
  v_needs_review boolean := false;
  v_expires_at   timestamptz;
BEGIN
  -- Row lock serializes concurrent accepts on the same proposal.
  SELECT * INTO v_proposal
  FROM trade_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade proposal not found';
  END IF;

  -- If someone else already finalized the proposal, treat as a no-op so the
  -- late caller can fall through to invalidation without error.
  IF v_proposal.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'all_accepted',       v_proposal.status IN ('accepted','in_review','completed','pending_drops','delayed'),
      'needs_review',       v_proposal.status = 'in_review',
      'already_finalized',  true,
      'status',             v_proposal.status
    );
  END IF;

  -- Caller must own the team they're accepting on behalf of. Without this,
  -- because the function is SECURITY DEFINER (bypasses RLS on the UPDATE
  -- below), any authenticated user could pass an arbitrary p_team_id and
  -- forge an acceptance + forced drops on someone else's team.
  IF NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = p_team_id AND user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized to act on behalf of team %', p_team_id;
  END IF;

  -- Caller's team must be a party to the trade.
  IF NOT EXISTS (
    SELECT 1 FROM trade_proposal_teams
    WHERE proposal_id = p_proposal_id AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Team % is not part of this trade proposal', p_team_id;
  END IF;

  UPDATE trade_proposal_teams
  SET status          = 'accepted',
      responded_at    = now(),
      drop_player_ids = COALESCE(p_drop_player_ids, drop_player_ids)
  WHERE proposal_id = p_proposal_id
    AND team_id     = p_team_id;

  SELECT
    count(*) FILTER (WHERE status = 'accepted'),
    count(*)
  INTO v_accepted, v_total
  FROM trade_proposal_teams
  WHERE proposal_id = p_proposal_id;

  v_all_accepted := v_accepted = v_total;

  IF v_all_accepted THEN
    IF p_veto_type = 'none' THEN
      UPDATE trade_proposals
      SET status      = 'accepted',
          accepted_at = now()
      WHERE id = p_proposal_id;
    ELSE
      v_needs_review := true;
      v_expires_at   := now() + make_interval(hours => COALESCE(p_review_hours, 24));
      UPDATE trade_proposals
      SET status             = 'in_review',
          accepted_at        = now(),
          review_expires_at  = v_expires_at
      WHERE id = p_proposal_id;
    END IF;

    -- Cancel conflicting active proposals sharing any asset with this one —
    -- done in-txn so they can't race to execution ahead of this proposal.
    UPDATE trade_proposals tp
    SET status = 'cancelled'
    WHERE tp.id IN (
      SELECT DISTINCT other.proposal_id
      FROM trade_proposal_items mine
      JOIN trade_proposal_items other
        ON (mine.player_id IS NOT NULL      AND mine.player_id      = other.player_id)
        OR (mine.draft_pick_id IS NOT NULL  AND mine.draft_pick_id  = other.draft_pick_id)
      WHERE mine.proposal_id  = p_proposal_id
        AND other.proposal_id <> p_proposal_id
    )
      AND tp.status IN ('pending', 'accepted');
  END IF;

  RETURN jsonb_build_object(
    'all_accepted',        v_all_accepted,
    'needs_review',        v_needs_review,
    'already_finalized',   false,
    'accepted_count',      v_accepted,
    'total_teams',         v_total,
    'proposed_by_team_id', v_proposal.proposed_by_team_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION accept_trade_proposal(uuid, uuid, uuid[], text, int)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. execute_trade_transfers: add atomic drop processing
-- ---------------------------------------------------------------------------
-- Adding a parameter requires DROP first (Postgres can't REPLACE across
-- signature changes). The only caller is the execute-trade edge function
-- which is deployed in lockstep with this migration.

DROP FUNCTION IF EXISTS execute_trade_transfers(
  uuid, uuid, uuid, timestamptz, date, date, jsonb, jsonb, jsonb, text
);

CREATE OR REPLACE FUNCTION execute_trade_transfers(
  p_league_id       uuid,
  p_proposal_id     uuid,
  p_proposed_by     uuid,
  p_timestamp       timestamptz,
  p_today           date,
  p_week_start      date,       -- nullable: current week start for pre-trade snapshots
  p_player_moves    jsonb,      -- array of { player_id, from_team_id, to_team_id, target_slot, pre_trade_slot }
  p_pick_moves      jsonb,      -- array of { draft_pick_id, from_team_id, to_team_id, protection_threshold? }
  p_pick_swaps      jsonb,      -- array of { season, round, beneficiary_team_id, counterparty_team_id }
  p_notes           text,
  p_drops           jsonb DEFAULT '[]'::jsonb  -- array of { team_id, player_id, waiver_until? }
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
  v_swap      jsonb;
  v_drop      jsonb;
  v_drop_team uuid;
  v_drop_pid  uuid;
  v_drop_slot text;
  v_drop_acq  timestamptz;
  v_txn_id    uuid;
  v_prot      int;
BEGIN
  -- 0. Process drops FIRST so the roster has room for incoming players.
  --    The DELETE guards on team_id, so a stale drop target (already traded
  --    away, already dropped elsewhere) produces NOT FOUND and aborts the
  --    whole transaction — no half-applied trade.
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

    -- Preserve current-week scoring history for the dropped player.
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

    -- Optional waiver placement. The edge function decides the window and
    -- passes waiver_until; if absent, the player becomes an immediate FA.
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

  -- 3. Transfer draft picks
  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_pick_moves)
  LOOP
    v_prot := (v_pick->>'protection_threshold')::int;

    UPDATE draft_picks
    SET current_team_id      = (v_pick->>'to_team_id')::uuid,
        protection_threshold = COALESCE(v_prot, protection_threshold),
        protection_owner_id  = CASE WHEN v_prot IS NOT NULL
                                    THEN (v_pick->>'from_team_id')::uuid
                                    ELSE protection_owner_id END
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
