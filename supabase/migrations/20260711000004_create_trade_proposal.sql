-- Atomic trade-proposal creation.
--
-- ProposeTradeModal wrote a proposal in four independent commits:
--   INSERT trade_proposals          → the proposal now EXISTS and is visible
--   UPDATE  (cancel the parent)     → only for a counteroffer / edit
--   INSERT trade_proposal_teams     → who's involved and who has accepted
--   INSERT trade_proposal_items     → what's actually being traded
--
-- Two distinct failures fell out of that ordering:
--
--   * Fail after the first insert and the league has a PHANTOM proposal — it
--     shows up in the trades list, the other GM can open it and hit Accept, and
--     it transfers nothing because it has no items and no team rows.
--   * Fail after the cancel but before the items land, and the ORIGINAL proposal
--     is dead while the replacement is malformed — the user's trade is simply
--     gone, and re-proposing means rebuilding it from scratch.
--
-- Conversely, if the INSERT lands but the CANCEL doesn't, the original and the
-- counteroffer are both live and both acceptable — the same two players can be
-- traded twice.
--
-- One transaction, so a proposal is either complete or absent. The zero-asset
-- check moves server-side too: an empty proposal is now impossible to create,
-- not just discouraged by the client.

CREATE OR REPLACE FUNCTION public.create_trade_proposal(
  p_league_id uuid,
  p_proposed_by_team_id uuid,
  p_team_ids uuid[],                       -- every team in the trade, incl. the proposer
  p_items jsonb,                           -- [{player_id, draft_pick_id, from_team_id, to_team_id, ...}]
  p_notes text DEFAULT NULL,
  p_counteroffer_of uuid DEFAULT NULL,
  p_is_in_draft boolean DEFAULT false,
  p_cancel_proposal_id uuid DEFAULT NULL   -- the proposal this one replaces
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id uuid;
  v_bad_team    uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM teams
        WHERE id = p_proposed_by_team_id AND league_id = p_league_id AND user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'not_authorized: you do not own the proposing team' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'no_assets: a trade must move at least one player or pick' USING ERRCODE = 'P0001';
  END IF;

  -- Every team named in the proposal must actually be in this league, and every
  -- asset must move between teams that are party to it. Without this, a doctored
  -- payload could name a team from another league as the destination.
  SELECT t INTO v_bad_team
    FROM unnest(p_team_ids) AS t
   WHERE NOT EXISTS (SELECT 1 FROM teams WHERE id = t AND league_id = p_league_id)
   LIMIT 1;
  IF v_bad_team IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_team: % is not in this league', v_bad_team USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS i
     WHERE (i->>'from_team_id')::uuid <> ALL(p_team_ids)
        OR (i->>'to_team_id')::uuid   <> ALL(p_team_ids)
  ) THEN
    RAISE EXCEPTION 'invalid_item: an asset moves to or from a team not in this trade'
      USING ERRCODE = 'P0001';
  END IF;

  -- Retire the proposal being replaced, so the original and its counteroffer
  -- can never both be live (double-accept). Scoped to proposals the caller is
  -- actually party to — a SECURITY DEFINER function must not let anyone cancel
  -- an arbitrary proposal by id.
  IF p_cancel_proposal_id IS NOT NULL THEN
    UPDATE trade_proposals SET status = 'cancelled'
     WHERE id = p_cancel_proposal_id
       AND league_id = p_league_id
       AND status IN ('pending', 'in_review', 'delayed', 'pending_drops')
       AND (
         proposed_by_team_id = p_proposed_by_team_id
         OR EXISTS (
           SELECT 1 FROM trade_proposal_teams tpt
            WHERE tpt.proposal_id = p_cancel_proposal_id
              AND tpt.team_id = p_proposed_by_team_id
         )
       );
  END IF;

  INSERT INTO trade_proposals (
    league_id, proposed_by_team_id, status, notes, counteroffer_of, is_in_draft
  ) VALUES (
    p_league_id, p_proposed_by_team_id, 'pending', p_notes, p_counteroffer_of, p_is_in_draft
  )
  RETURNING id INTO v_proposal_id;

  -- The proposer implicitly accepts their own offer.
  INSERT INTO trade_proposal_teams (proposal_id, team_id, status, responded_at)
  SELECT v_proposal_id, t,
         CASE WHEN t = p_proposed_by_team_id THEN 'accepted' ELSE 'pending' END,
         CASE WHEN t = p_proposed_by_team_id THEN now() ELSE NULL END
    FROM unnest(p_team_ids) AS t;

  INSERT INTO trade_proposal_items (
    proposal_id, player_id, draft_pick_id, from_team_id, to_team_id,
    protection_threshold, pick_swap_season, pick_swap_round
  )
  SELECT v_proposal_id,
         nullif(i->>'player_id', '')::uuid,
         nullif(i->>'draft_pick_id', '')::uuid,
         (i->>'from_team_id')::uuid,
         (i->>'to_team_id')::uuid,
         nullif(i->>'protection_threshold', '')::integer,
         nullif(i->>'pick_swap_season', '')::text,
         nullif(i->>'pick_swap_round', '')::integer
    FROM jsonb_array_elements(p_items) AS i;

  RETURN v_proposal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_trade_proposal(uuid, uuid, uuid[], jsonb, text, uuid, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_trade_proposal(uuid, uuid, uuid[], jsonb, text, uuid, boolean, uuid) FROM public;
REVOKE ALL ON FUNCTION public.create_trade_proposal(uuid, uuid, uuid[], jsonb, text, uuid, boolean, uuid) FROM anon;
