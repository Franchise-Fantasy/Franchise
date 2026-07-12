-- Atomic trade reversal — the mirror of execute_trade_transfers.
--
-- reverse-trade moved every player back, then every pick, then deleted the pick
-- swaps, then wrote the ledger, and only THEN set the proposal to 'reversed' —
-- each its own commit. A failure part-way through left the trade half-reversed
-- AND still marked 'completed', and the retry made it permanent:
--
--   the per-player step skips anyone "no longer on the receiving team", which is
--   exactly what the already-reversed players now look like. So the retry
--   silently skips them, reverses the rest, and reports success. The trade is
--   now permanently split down the middle, with a ledger that claims it was
--   fully undone.
--
-- One transaction fixes both halves of that: a failure reverses nothing, and the
-- status flips with the transfers rather than after them.
--
-- The status re-check under FOR UPDATE also makes a double-click (or a double
-- delivery) a no-op rather than a second reversal — the second caller sees a
-- status that is no longer 'completed' and gets a 409.
--
-- The "skipped" warnings are a genuine business rule, not an error path: a
-- player traded away and then dropped, or a pick already used in a draft, can't
-- be handed back. Those stay, and are returned for the commissioner to read.

CREATE OR REPLACE FUNCTION public.reverse_trade_transfers(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id   uuid;
  v_proposer    uuid;
  v_status      text;
  v_warnings    text[] := ARRAY[]::text[];
  v_item        record;
  v_pick        record;
  v_notes       text;
  v_teams       text;
  v_txn_id      uuid;
BEGIN
  SELECT league_id, proposed_by_team_id, status
    INTO v_league_id, v_proposer, v_status
    FROM trade_proposals WHERE id = p_proposal_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'not_completed: trade is %, not completed', v_status
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ── Players: send each one back to the team that traded them away ───────
  FOR v_item IN
    SELECT player_id, from_team_id, to_team_id
      FROM trade_proposal_items
     WHERE proposal_id = p_proposal_id AND player_id IS NOT NULL
  LOOP
    UPDATE league_players
       SET team_id      = v_item.from_team_id,
           acquired_via = 'trade_reversal',
           acquired_at  = now(),
           roster_slot  = 'BE'
     WHERE league_id = v_league_id
       AND player_id = v_item.player_id
       AND team_id   = v_item.to_team_id;

    IF NOT FOUND THEN
      -- Dropped, re-traded, or otherwise gone from the receiving team.
      v_warnings := array_append(
        v_warnings,
        coalesce((SELECT name FROM players WHERE id = v_item.player_id), 'Unknown player')
          || ' is no longer on the receiving team — skipped.'
      );
    END IF;
  END LOOP;

  -- ── Picks: hand each one back, unless it's already been used ────────────
  FOR v_item IN
    SELECT draft_pick_id, from_team_id, protection_threshold
      FROM trade_proposal_items
     WHERE proposal_id = p_proposal_id AND draft_pick_id IS NOT NULL
  LOOP
    SELECT player_id, season, round INTO v_pick
      FROM draft_picks WHERE id = v_item.draft_pick_id;

    IF v_pick.player_id IS NOT NULL THEN
      v_warnings := array_append(
        v_warnings,
        v_pick.season || ' Rd ' || v_pick.round || ' pick already used — skipped.'
      );
      CONTINUE;
    END IF;

    -- Only clear protection if THIS trade is what set it; a pick that was
    -- already protected before the trade keeps its prior protection.
    IF v_item.protection_threshold IS NOT NULL THEN
      UPDATE draft_picks
         SET current_team_id      = v_item.from_team_id,
             protection_threshold = NULL,
             protection_owner_id  = NULL
       WHERE id = v_item.draft_pick_id;
    ELSE
      UPDATE draft_picks
         SET current_team_id = v_item.from_team_id
       WHERE id = v_item.draft_pick_id;
    END IF;
  END LOOP;

  DELETE FROM pick_swaps WHERE created_by_proposal_id = p_proposal_id;

  SELECT string_agg(DISTINCT coalesce(t.name, 'Unknown'), ' & ')
    INTO v_teams
    FROM trade_proposal_items tpi
    LEFT JOIN teams t ON t.id = tpi.from_team_id
   WHERE tpi.proposal_id = p_proposal_id;

  v_notes := 'Commissioner reversed trade between ' || coalesce(v_teams, 'Unknown')
    || CASE WHEN array_length(v_warnings, 1) > 0
            THEN ' (' || array_length(v_warnings, 1) || ' item(s) skipped)'
            ELSE '' END;

  INSERT INTO league_transactions (league_id, type, team_id, notes)
  VALUES (v_league_id, 'commissioner', v_proposer, v_notes)
  RETURNING id INTO v_txn_id;

  -- Ledger mirrors the reversal: assets flow back the other way.
  INSERT INTO league_transaction_items (transaction_id, player_id, draft_pick_id, team_from_id, team_to_id)
  SELECT v_txn_id, player_id, draft_pick_id, to_team_id, from_team_id
    FROM trade_proposal_items
   WHERE proposal_id = p_proposal_id;

  UPDATE trade_proposals SET status = 'reversed' WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'warnings', to_jsonb(v_warnings),
    'team_ids', (
      SELECT to_jsonb(array_agg(DISTINCT tid))
        FROM (
          SELECT unnest(ARRAY[from_team_id, to_team_id]) AS tid
            FROM trade_proposal_items WHERE proposal_id = p_proposal_id
        ) x
    )
  );
END;
$$;

-- The edge function owns the commissioner check.
GRANT EXECUTE ON FUNCTION public.reverse_trade_transfers(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.reverse_trade_transfers(uuid) FROM public;
REVOKE ALL ON FUNCTION public.reverse_trade_transfers(uuid) FROM anon, authenticated;
