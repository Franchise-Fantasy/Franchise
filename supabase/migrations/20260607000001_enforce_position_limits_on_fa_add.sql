-- Enforce per-position roster limits on the free-agent add path (server side).
--
-- Until now leagues.position_limits was enforced only on the client (and only
-- on the plain instant add — the queued add+drop path skipped it entirely) and
-- in process-waivers. A direct FA add could therefore exceed a position cap.
-- This wires the same check into assert_can_add_free_agent so every add path
-- (instant, add+drop, queued-drop) is gated server-side, matching the waiver
-- path.
--
-- The new p_player_id arg lets the function read the incoming player's position
-- from the players table (not a client-supplied string) and count the team's
-- active roster by position. Queued drops (pending_transactions + queued trade
-- drops) are excluded from the count so an add+drop that swaps same-position
-- players doesn't false-trip the cap.

-- ─────────────────────────────────────────────────────────────────────────────
-- PAIRED LOGIC — keep in sync with getLimitMatchKeys / POSITION_TOKEN_RANGES /
-- POSITION_SPECTRUM in utils/roster/rosterSlotsShared.ts. Returns every limit
-- key a player position counts toward: the spectrum positions it spans, plus the
-- bare-letter parents (G covers PG/SG, F covers SF/PF) so one check handles both
-- NBA (PG/SG/SF/PF/C) and WNBA (G/F/C) limit configs. If you change the spectrum
-- or token ranges on the TS side, change them here too.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.position_limit_match_keys(p_position text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  spectrum text[] := ARRAY['PG', 'SG', 'SF', 'PF', 'C']; -- 1-based: PG=1 .. C=5
  tok text;
  lo int := NULL;
  hi int := NULL;
  s int;
  e int;
  eligible text[];
  keys text[];
BEGIN
  IF p_position IS NULL OR p_position = '' THEN
    RETURN ARRAY[]::text[];
  END IF;

  FOREACH tok IN ARRAY string_to_array(p_position, '-') LOOP
    s := NULL;
    e := NULL;
    CASE tok
      WHEN 'PG' THEN s := 1; e := 1;
      WHEN 'SG' THEN s := 2; e := 2;
      WHEN 'SF' THEN s := 3; e := 3;
      WHEN 'PF' THEN s := 4; e := 4;
      WHEN 'C'  THEN s := 5; e := 5;
      WHEN 'G'  THEN s := 1; e := 2; -- WNBA bare guard
      WHEN 'F'  THEN s := 3; e := 4; -- WNBA bare forward
      ELSE s := NULL;
    END CASE;
    IF s IS NOT NULL THEN
      IF lo IS NULL OR s < lo THEN lo := s; END IF;
      IF hi IS NULL OR e > hi THEN hi := e; END IF;
    END IF;
  END LOOP;

  IF lo IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  eligible := spectrum[lo:hi];
  keys := eligible;
  -- array_append (not `|| 'G'`) — `text[] || text` is ambiguous and Postgres
  -- mis-resolves it to array||array, trying to parse 'G' as an array literal.
  IF 'PG' = ANY(eligible) OR 'SG' = ANY(eligible) THEN keys := array_append(keys, 'G'); END IF;
  IF 'SF' = ANY(eligible) OR 'PF' = ANY(eligible) THEN keys := array_append(keys, 'F'); END IF;
  RETURN keys;
END;
$$;

-- Replace the (uuid, uuid) guard with a (uuid, uuid, uuid) version. p_player_id
-- defaults to NULL so a caller that omits it gets the original size-only check.
DROP FUNCTION IF EXISTS public.assert_can_add_free_agent(uuid, uuid);

CREATE OR REPLACE FUNCTION public.assert_can_add_free_agent(
  p_league_id uuid,
  p_team_id uuid,
  p_player_id uuid DEFAULT NULL
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
  v_position_limits jsonb;
  v_position text;
  v_key text;
  v_max int;
  v_pos_count int;
BEGIN
  SELECT roster_size, position_limits INTO v_roster_size, v_position_limits
    FROM leagues WHERE id = p_league_id;
  IF v_roster_size IS NULL THEN
    RAISE EXCEPTION 'League not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_active_count
    FROM league_players
   WHERE league_id = p_league_id
     AND team_id = p_team_id
     AND coalesce(roster_slot, '') NOT IN ('IR', 'TAXI');

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
  -- of an IR/TAXI player or an already-removed player doesn't inflate the
  -- offset.
  SELECT count(*) INTO v_pending_txn_drops
    FROM pending_transactions pt
    JOIN league_players lp ON lp.league_id = pt.league_id
      AND lp.team_id  = pt.team_id
      AND lp.player_id = pt.player_id
   WHERE pt.league_id = p_league_id
     AND pt.team_id   = p_team_id
     AND pt.action_type = 'drop'
     AND pt.status      = 'pending'
     AND coalesce(lp.roster_slot, '') NOT IN ('IR', 'TAXI');

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

  -- Per-position limit check. Only when a player + non-empty limits are given.
  -- Read the incoming player's position from players (not a client string) and
  -- count the team's active roster by each limit key the incoming player counts
  -- toward, excluding any player already queued to be dropped (so an add+drop
  -- that swaps same-position players nets to zero).
  IF p_player_id IS NOT NULL
     AND v_position_limits IS NOT NULL
     AND v_position_limits <> '{}'::jsonb THEN
    SELECT position INTO v_position FROM players WHERE id = p_player_id;

    FOREACH v_key IN ARRAY public.position_limit_match_keys(coalesce(v_position, '')) LOOP
      v_max := (v_position_limits ->> v_key)::int;
      IF v_max IS NOT NULL AND v_max > 0 THEN
        SELECT count(*) INTO v_pos_count
          FROM league_players lp
         WHERE lp.league_id = p_league_id
           AND lp.team_id = p_team_id
           AND coalesce(lp.roster_slot, '') NOT IN ('IR', 'TAXI')
           AND v_key = ANY(public.position_limit_match_keys(lp.position))
           AND NOT EXISTS (
             SELECT 1 FROM pending_transactions pt
              WHERE pt.league_id = p_league_id
                AND pt.team_id = p_team_id
                AND pt.action_type = 'drop'
                AND pt.status = 'pending'
                AND pt.player_id = lp.player_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM trade_proposal_teams tpt
              JOIN trade_proposals tp ON tp.id = tpt.proposal_id
              WHERE tp.league_id = p_league_id
                AND tp.transaction_id IS NULL
                AND tp.status IN ('pending', 'accepted', 'in_review', 'delayed', 'pending_drops')
                AND tpt.team_id = p_team_id
                AND lp.player_id = ANY(tpt.drop_player_ids)
           );

        IF v_pos_count >= v_max THEN
          RAISE EXCEPTION 'position_limit_full: position=%, max=%', v_key, v_max
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_can_add_free_agent(uuid, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.position_limit_match_keys(text)
  TO anon, authenticated, service_role;
