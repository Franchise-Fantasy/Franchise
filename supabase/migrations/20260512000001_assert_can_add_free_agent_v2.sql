-- Free-agency × pending-trade × queued-drop roster guard (v2).
--
-- v1 only accounted for drops queued on trade proposals. The locked-day
-- add-and-drop flow (pending_transactions) was invisible to the guard, so
-- it rejected legitimate adds with a misleading "pending trades would
-- overflow roster" error. v2 also subtracts queued drops in
-- pending_transactions, and splits the error code so the client can show
-- "your roster is full" when no actual trade is involved.

CREATE OR REPLACE FUNCTION public.assert_can_add_free_agent(
  p_league_id uuid,
  p_team_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_roster_size int;
  v_active_count int;
  v_net_incoming int;
  v_queued_trade_drops int;
  v_pending_txn_drops int;
  v_projected int;
BEGIN
  SELECT roster_size INTO v_roster_size
    FROM leagues WHERE id = p_league_id;
  IF v_roster_size IS NULL THEN
    RAISE EXCEPTION 'League not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_active_count
    FROM league_players
   WHERE league_id = p_league_id
     AND team_id = p_team_id
     AND coalesce(roster_slot, '') <> 'IR';

  SELECT coalesce(sum(
    case
      when tpi.to_team_id   = p_team_id then 1
      when tpi.from_team_id = p_team_id then -1
      else 0
    end
  ), 0) INTO v_net_incoming
    FROM trade_proposal_items tpi
    JOIN trade_proposals tp ON tp.id = tpi.proposal_id
   WHERE tp.league_id = p_league_id
     AND tp.transaction_id IS NULL
     AND tp.status IN ('pending', 'accepted', 'in_review', 'delayed', 'pending_drops')
     AND tpi.player_id IS NOT NULL
     AND (tpi.to_team_id = p_team_id OR tpi.from_team_id = p_team_id);

  SELECT coalesce(sum(coalesce(array_length(tpt.drop_player_ids, 1), 0)), 0)
    INTO v_queued_trade_drops
    FROM trade_proposal_teams tpt
    JOIN trade_proposals tp ON tp.id = tpt.proposal_id
   WHERE tp.league_id = p_league_id
     AND tp.transaction_id IS NULL
     AND tp.status IN ('pending', 'accepted', 'in_review', 'delayed', 'pending_drops')
     AND tpt.team_id = p_team_id;

  -- Drops queued in pending_transactions (locked-day add-and-drop, etc.).
  -- Only count drops whose target is still on the active roster, so a drop
  -- of an IR player or an already-removed player doesn't inflate the offset.
  SELECT count(*) INTO v_pending_txn_drops
    FROM pending_transactions pt
    JOIN league_players lp ON lp.league_id = pt.league_id
      AND lp.team_id  = pt.team_id
      AND lp.player_id = pt.player_id
   WHERE pt.league_id = p_league_id
     AND pt.team_id   = p_team_id
     AND pt.action_type = 'drop'
     AND pt.status      = 'pending'
     AND coalesce(lp.roster_slot, '') <> 'IR';

  v_projected := v_active_count + 1 + v_net_incoming
                 - v_queued_trade_drops - v_pending_txn_drops;

  IF v_projected > v_roster_size THEN
    IF v_net_incoming > 0 OR v_queued_trade_drops > 0 THEN
      RAISE EXCEPTION
        'pending_trades_would_overflow_roster: roster_size=%, active=%, net_incoming=%, trade_drops=%, txn_drops=%, projected=%',
        v_roster_size, v_active_count, v_net_incoming,
        v_queued_trade_drops, v_pending_txn_drops, v_projected
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'roster_full: roster_size=%, active=%, projected=%',
        v_roster_size, v_active_count, v_projected
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid)
  TO anon, authenticated, service_role;
