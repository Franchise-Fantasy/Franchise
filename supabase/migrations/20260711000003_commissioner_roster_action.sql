-- Atomic commissioner force_add / force_drop / force_move.
--
-- commissioner-action applied the roster change, then logged the transaction,
-- then logged its item — three commits. A failure after the first left the
-- roster mutated with no audit trail, which for a *commissioner override* is the
-- one write that most needs one: the affected GM sees a player appear or vanish
-- and the activity feed says nothing happened. force_drop was worse still — it
-- deleted from league_players and then from daily_lineups separately, so a
-- failure between them left lineup rows pointing at a player no longer rostered.
--
-- Also fixes a latent date bug carried over from the old code: force_drop and
-- force_move anchored to `new Date().toISOString().split('T')[0]` — the UTC
-- calendar date. Between 7pm and midnight ET that is already *tomorrow* in UTC,
-- so a commissioner drop made during a game deleted tomorrow's lineup rows and
-- left today's in place — the dropped player kept scoring for the rest of the
-- night. Now anchored to sport_slate_date() like every other roster path.
--
-- The commissioner check itself stays in the edge function (it owns the JWT).
-- This is service_role-only.

CREATE OR REPLACE FUNCTION public.commissioner_roster_action(
  p_league_id uuid,
  p_team_id uuid,
  p_player_id uuid,
  p_action text,                        -- 'force_add' | 'force_drop' | 'force_move'
  p_position text DEFAULT NULL,         -- force_add
  p_target_slot text DEFAULT NULL,      -- force_move
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        date;
  v_current_slot text;
  v_promoted     boolean;
  v_txn_id       uuid;
  v_from         uuid;
  v_to           uuid;
BEGIN
  v_today := sport_slate_date();

  IF p_action = 'force_add' THEN
    IF p_position IS NULL THEN
      RAISE EXCEPTION 'position is required for force_add' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO league_players (
      league_id, team_id, player_id, position, roster_slot, acquired_via, acquired_at
    ) VALUES (
      p_league_id, p_team_id, p_player_id, p_position, 'BE', 'commissioner', now()
    );
    v_to := p_team_id;

  ELSIF p_action = 'force_drop' THEN
    DELETE FROM league_players
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_player_id;

    DELETE FROM daily_lineups
     WHERE team_id = p_team_id AND player_id = p_player_id AND lineup_date >= v_today;
    v_from := p_team_id;

  ELSIF p_action = 'force_move' THEN
    IF p_target_slot IS NULL THEN
      RAISE EXCEPTION 'target_slot is required for force_move' USING ERRCODE = 'P0001';
    END IF;

    SELECT roster_slot INTO v_current_slot
      FROM league_players
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_player_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'player_not_on_roster' USING ERRCODE = 'P0002';
    END IF;

    -- Promotion off the taxi squad is one-way; entering taxi clears the flag.
    -- Mirrors the GM path in apply_roster_move.
    v_promoted := CASE
      WHEN v_current_slot = 'TAXI' AND p_target_slot <> 'TAXI' THEN true
      WHEN p_target_slot = 'TAXI' THEN false
      ELSE NULL
    END;

    IF v_promoted IS NULL THEN
      UPDATE league_players SET roster_slot = p_target_slot
       WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_player_id;
    ELSE
      UPDATE league_players SET roster_slot = p_target_slot, promoted_from_taxi = v_promoted
       WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_player_id;
    END IF;

    INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    VALUES (p_league_id, p_team_id, p_player_id, v_today, p_target_slot)
    ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = EXCLUDED.roster_slot;

    v_from := p_team_id;
    v_to   := p_team_id;

  ELSE
    RAISE EXCEPTION 'unknown_action: %', p_action USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO league_transactions (league_id, type, team_id, notes)
  VALUES (p_league_id, 'commissioner', p_team_id, p_notes)
  RETURNING id INTO v_txn_id;

  INSERT INTO league_transaction_items (transaction_id, player_id, team_from_id, team_to_id)
  VALUES (v_txn_id, p_player_id, v_from, v_to);

  RETURN jsonb_build_object('transaction_id', v_txn_id);
END;
$$;

-- The edge function owns the commissioner check, so this is service_role only.
GRANT EXECUTE ON FUNCTION public.commissioner_roster_action(uuid, uuid, uuid, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.commissioner_roster_action(uuid, uuid, uuid, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.commissioner_roster_action(uuid, uuid, uuid, text, text, text, text) FROM anon, authenticated;
