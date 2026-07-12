-- Atomic waiver award. process-waivers deletes each expired league_waivers row
-- upfront (to claim it against overlapping cron runs), then per winning claim it
-- ran the AWARD (insert league_players + daily_lineups + league_transactions +
-- items + mark claim 'successful') and the COST (FAAB debit OR waiver-priority
-- rotation) plus mark-losers as SEPARATE PostgREST writes. Because the waiver
-- row is already gone and the claim is already 'successful', a crash BETWEEN the
-- award and the cost is unrecoverable: the player is never reprocessed, so a FAAB
-- winner keeps the player for free (budget never debited) or a standard winner
-- keeps top waiver priority (rotation never ran).
--
-- This folds the drop, award, transaction log, claim-status flip, cost, and
-- mark-losers into ONE transaction. The read-side checks (roster full, position
-- limits, drop availability) and the lineup snapshot stay in the edge function;
-- when they pass it calls this to commit every write together. The award insert
-- relies on uq_league_player(league_id, player_id): a concurrent add makes it
-- raise unique_violation, which rolls the whole award back (edge maps 23505 ->
-- already_owned and tries the next claim).
--
-- p_execute_drop        actually delete + waiver the drop player (edge decides:
--                       only when roster is full AND the drop is still rostered)
-- p_drop_player_id      the claim's drop, recorded in the txn item even when the
--                       drop is skipped (roster not full) — matches prior behavior
-- p_drop_waiver_until   when the dropped player clears waivers (null = no waiver)
-- Returns { ok:true } or { ok:false, reason:'already_owned' }.

CREATE OR REPLACE FUNCTION public.award_waiver_claim(
  p_claim_id uuid,
  p_league_id uuid,
  p_player_id uuid,
  p_team_id uuid,
  p_position text,
  p_bid_amount numeric,
  p_is_faab boolean,
  p_drop_player_id uuid,
  p_execute_drop boolean,
  p_drop_waiver_until timestamptz,
  p_notes text,
  p_now timestamptz,
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn_id uuid;
  v_winner_priority integer;
  v_team_count integer;
BEGIN
  -- Graceful already-owned (the insert's unique_violation is the race backstop).
  IF EXISTS (SELECT 1 FROM league_players WHERE league_id = p_league_id AND player_id = p_player_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_owned');
  END IF;

  -- Execute the drop atomically with the award (so the team can never lose the
  -- dropped player without gaining the claimed one, or vice versa).
  IF p_execute_drop AND p_drop_player_id IS NOT NULL THEN
    DELETE FROM league_players
    WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_drop_player_id;
    IF p_drop_waiver_until IS NOT NULL THEN
      INSERT INTO league_waivers (league_id, player_id, on_waivers_until, dropped_by_team_id)
      VALUES (p_league_id, p_drop_player_id, p_drop_waiver_until, p_team_id);
    END IF;
  END IF;

  -- Award. unique_violation propagates -> whole txn rolls back.
  INSERT INTO league_players (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
  VALUES (p_league_id, p_player_id, p_team_id, 'waiver', p_now, p_position, 'BE');

  -- Day-one lineup slot so slot history is consistent.
  INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
  VALUES (p_league_id, p_team_id, p_player_id, p_today, 'BE')
  ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'BE';

  -- Transaction + items.
  INSERT INTO league_transactions (league_id, type, notes, team_id, bid_amount)
  VALUES (p_league_id, 'waiver', p_notes, p_team_id,
          CASE WHEN COALESCE(p_bid_amount, 0) > 0 THEN p_bid_amount ELSE NULL END)
  RETURNING id INTO v_txn_id;

  INSERT INTO league_transaction_items (transaction_id, player_id, team_to_id)
  VALUES (v_txn_id, p_player_id, p_team_id);
  IF p_drop_player_id IS NOT NULL THEN
    INSERT INTO league_transaction_items (transaction_id, player_id, team_from_id)
    VALUES (v_txn_id, p_drop_player_id, p_team_id);
  END IF;

  -- Mark the winning claim.
  UPDATE waiver_claims SET status = 'successful', processed_at = p_now WHERE id = p_claim_id;

  -- The COST — same transaction as the award, closing the money/priority gap.
  IF p_is_faab THEN
    UPDATE waiver_priority
    SET faab_remaining = GREATEST(0, COALESCE(faab_remaining, 0) - COALESCE(p_bid_amount, 0))
    WHERE league_id = p_league_id AND team_id = p_team_id;
  ELSE
    -- Rotate: winner drops to last, everyone below the winner moves up one.
    SELECT priority INTO v_winner_priority
    FROM waiver_priority WHERE league_id = p_league_id AND team_id = p_team_id;
    IF v_winner_priority IS NOT NULL THEN
      SELECT count(*) INTO v_team_count FROM waiver_priority WHERE league_id = p_league_id;
      UPDATE waiver_priority
      SET priority = CASE WHEN team_id = p_team_id THEN v_team_count ELSE priority - 1 END
      WHERE league_id = p_league_id
        AND (team_id = p_team_id OR priority > v_winner_priority);
    END IF;
  END IF;

  -- Mark every other pending claim for this player as failed.
  UPDATE waiver_claims SET status = 'failed', processed_at = p_now
  WHERE league_id = p_league_id AND player_id = p_player_id
    AND status = 'pending' AND id <> p_claim_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Service-role / definer only (cron calls with the service key; the edge owns the
-- read-side checks). REVOKE from public AND anon/authenticated.
GRANT EXECUTE ON FUNCTION public.award_waiver_claim(uuid, uuid, uuid, uuid, text, numeric, boolean, uuid, boolean, timestamptz, text, timestamptz, date) TO service_role;
REVOKE ALL ON FUNCTION public.award_waiver_claim(uuid, uuid, uuid, uuid, text, numeric, boolean, uuid, boolean, timestamptz, text, timestamptz, date) FROM public;
REVOKE ALL ON FUNCTION public.award_waiver_claim(uuid, uuid, uuid, uuid, text, numeric, boolean, uuid, boolean, timestamptz, text, timestamptz, date) FROM anon, authenticated;
