-- Free-agency × pending-trade roster guard.
--
-- Before allowing a free-agent add we must account for any pending trades
-- that would net-increase the team's roster. Without this check, a manager
-- with an open slot AND a pending incoming trade can fill the slot via FA,
-- and the trade later either fails into pending_drops or (if a drop was
-- already queued) silently drops a player the manager forgot about.
--
-- Active statuses below mirror the locked-asset list in execute-trade
-- (pending, accepted, in_review, delayed, pending_drops). cancelled,
-- rejected, expired, and completed proposals are excluded.

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
  v_queued_drops int;
  v_projected int;
BEGIN
  SELECT roster_size INTO v_roster_size
    FROM leagues WHERE id = p_league_id;
  IF v_roster_size IS NULL THEN
    RAISE EXCEPTION 'League not found' USING ERRCODE = 'P0002';
  END IF;

  -- Active roster excludes IR.
  SELECT count(*) INTO v_active_count
    FROM league_players
   WHERE league_id = p_league_id
     AND team_id = p_team_id
     AND coalesce(roster_slot, '') <> 'IR';

  -- Net player gain across pending trades involving this team. A trade item
  -- counts only when player_id is set (picks don't affect roster count).
  -- to_team_id = team → +1, from_team_id = team → -1.
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

  -- Drops already queued on those trades for this team offset incoming
  -- players one-for-one.
  SELECT coalesce(sum(coalesce(array_length(tpt.drop_player_ids, 1), 0)), 0)
    INTO v_queued_drops
    FROM trade_proposal_teams tpt
    JOIN trade_proposals tp ON tp.id = tpt.proposal_id
   WHERE tp.league_id = p_league_id
     AND tp.transaction_id IS NULL
     AND tp.status IN ('pending', 'accepted', 'in_review', 'delayed', 'pending_drops')
     AND tpt.team_id = p_team_id;

  v_projected := v_active_count + 1 + v_net_incoming - v_queued_drops;

  IF v_projected > v_roster_size THEN
    RAISE EXCEPTION
      'pending_trades_would_overflow_roster: roster_size=%, active=%, net_incoming=%, queued_drops=%, projected_after_add=%',
      v_roster_size, v_active_count, v_net_incoming, v_queued_drops, v_projected
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid)
  TO anon, authenticated, service_role;
