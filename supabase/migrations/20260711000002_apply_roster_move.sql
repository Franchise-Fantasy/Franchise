-- Atomic lineup / IR / taxi move.
--
-- roster.tsx handleRosterMove fired up to EIGHT independent writes to move one
-- player and displace another: pin today's slots (deferred moves), bench the
-- displaced player in daily_lineups AND league_players, rewrite their future
-- rows, then the same again for the moving player. A failure part-way through
-- committed a partial swap — most often the displaced player already bumped to
-- BE while the incoming player never took the slot (a hole), or the incoming
-- player written into a slot the displaced player still occupies (two players in
-- one seat, which is exactly the duplicate-active-slot corruption that
-- over-counted scoring and needed dedup_active_lineup_slots to clean up).
--
-- The move is a single logical operation, so it is now a single transaction.
--
-- The eligibility rules (is this player IR-eligible, is the team IR-locked or
-- over cap, does this move reduce the lockout) stay in TS: they depend on injury
-- status and roster-config state the client already holds, and duplicating them
-- in SQL would create exactly the kind of drift CLAUDE.md warns about. They are
-- UX gates on a move the GM owns either way — nothing here corrupts if one is
-- bypassed. What had to become atomic is the write fan-out, and that is what
-- this does.
--
-- `p_deferred` (a game is in progress, so an IR/TAXI change lands tomorrow) is
-- computed in TS from tip-off times the DB does not hold. Slate dates are
-- computed here.

CREATE OR REPLACE FUNCTION public.apply_roster_move(
  p_league_id uuid,
  p_team_id uuid,
  p_source_player_id uuid,
  p_source_slot text,
  p_dest_slot text,
  p_selected_date date,                    -- the roster day being edited
  p_dest_player_id uuid DEFAULT NULL,      -- player being displaced, if any
  p_deferred boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today       date;
  v_effective   date;
  v_src_ir      boolean;
  v_src_taxi    boolean;
  v_dst_ir      boolean;
  v_dst_taxi    boolean;
  v_ir_or_taxi  boolean;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM teams
        WHERE id = p_team_id AND league_id = p_league_id AND user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'not_authorized: you do not own this team' USING ERRCODE = '42501';
  END IF;

  v_today := sport_slate_date();

  -- Already-played days are frozen: a finalized matchup scored off that day's
  -- snapshot, and unfinalized weeks are recomputed from daily_lineups — editing
  -- history here is what made finalized scores drift. The client refuses to
  -- write past days; enforce it where it can't be bypassed.
  IF p_selected_date < v_today THEN
    RAISE EXCEPTION 'past_day_locked: cannot edit a lineup before %', v_today USING ERRCODE = 'P0001';
  END IF;

  v_src_ir     := p_source_slot = 'IR';
  v_src_taxi   := p_source_slot = 'TAXI';
  v_dst_ir     := p_dest_slot   = 'IR';
  v_dst_taxi   := p_dest_slot   = 'TAXI';
  v_ir_or_taxi := v_src_ir OR v_src_taxi OR v_dst_ir OR v_dst_taxi;

  v_effective := CASE WHEN p_deferred THEN v_today + 1 ELSE p_selected_date END;

  -- ── 0. Deferred move: freeze today's slots ──────────────────────────────
  -- The change doesn't take effect until tomorrow, so pin both players' current
  -- slots into today's lineup. Without this, resolveSlot falls through to
  -- league_players and today's roster would show the new arrangement.
  IF p_deferred THEN
    INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    VALUES (p_league_id, p_team_id, p_source_player_id, v_today, p_source_slot)
    ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = EXCLUDED.roster_slot;

    IF p_dest_player_id IS NOT NULL THEN
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, p_team_id, p_dest_player_id, v_today, p_dest_slot)
      ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = EXCLUDED.roster_slot;
    END IF;
  END IF;

  -- ── 1. Displace whoever is in the destination slot ──────────────────────
  IF p_dest_player_id IS NOT NULL THEN
    IF v_dst_ir THEN
      -- Coming off IR: bench them from the effective day on.
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, p_team_id, p_dest_player_id, v_effective, 'BE')
      ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'BE';

      UPDATE daily_lineups SET roster_slot = 'BE'
       WHERE league_id = p_league_id AND team_id = p_team_id
         AND player_id = p_dest_player_id AND roster_slot = 'IR'
         AND lineup_date > v_effective;

      UPDATE league_players SET roster_slot = 'BE'
       WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_dest_player_id;

    ELSIF v_dst_taxi THEN
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, p_team_id, p_dest_player_id, v_effective, 'BE')
      ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = 'BE';

      UPDATE league_players SET roster_slot = 'BE'
       WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_dest_player_id;

    ELSE
      -- Plain swap: the displaced player takes the source slot.
      INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      VALUES (p_league_id, p_team_id, p_dest_player_id, p_selected_date, p_source_slot)
      ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = EXCLUDED.roster_slot;
    END IF;
  END IF;

  -- ── 2. Move the source player into the destination slot ─────────────────
  INSERT INTO daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
  VALUES (
    p_league_id, p_team_id, p_source_player_id,
    CASE WHEN v_ir_or_taxi THEN v_effective ELSE p_selected_date END,
    p_dest_slot
  )
  ON CONFLICT (team_id, player_id, lineup_date) DO UPDATE SET roster_slot = EXCLUDED.roster_slot;

  -- ── 3. Persist IR/TAXI membership + fix up future days ──────────────────
  IF v_dst_ir THEN
    UPDATE daily_lineups SET roster_slot = 'IR'
     WHERE league_id = p_league_id AND team_id = p_team_id
       AND player_id = p_source_player_id AND lineup_date > v_effective;

    UPDATE league_players SET roster_slot = 'IR'
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_source_player_id;

  ELSIF v_dst_taxi THEN
    -- Entering the taxi squad clears the promotion flag.
    UPDATE league_players SET roster_slot = 'TAXI', promoted_from_taxi = false
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_source_player_id;

  ELSIF v_src_ir THEN
    UPDATE daily_lineups SET roster_slot = 'BE'
     WHERE league_id = p_league_id AND team_id = p_team_id
       AND player_id = p_source_player_id AND roster_slot = 'IR'
       AND lineup_date > v_effective;

    UPDATE league_players SET roster_slot = p_dest_slot
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_source_player_id;

  ELSIF v_src_taxi THEN
    UPDATE daily_lineups SET roster_slot = 'BE'
     WHERE league_id = p_league_id AND team_id = p_team_id
       AND player_id = p_source_player_id AND roster_slot = 'TAXI'
       AND lineup_date > v_effective;

    -- Promotion off the taxi squad is one-way (see getQuickActions /
    -- getEligibleFillPlayers) — flag it so they can't be sent back down.
    UPDATE league_players SET roster_slot = p_dest_slot, promoted_from_taxi = true
     WHERE league_id = p_league_id AND team_id = p_team_id AND player_id = p_source_player_id;
  END IF;

  RETURN jsonb_build_object('effective_date', v_effective, 'deferred', p_deferred);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_roster_move(uuid, uuid, uuid, text, text, date, uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_roster_move(uuid, uuid, uuid, text, text, date, uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.apply_roster_move(uuid, uuid, uuid, text, text, date, uuid, boolean) FROM anon;
