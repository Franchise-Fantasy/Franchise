-- Atomic autopick writer. autodraft previously ran the pick as four separate
-- PostgREST writes: an optimistic claim (UPDATE draft_picks ... WHERE player_id
-- IS NULL), then INSERT league_players, then advance drafts, then (rookie)
-- advance leagues.offseason_step. The optimistic claim is the concurrency guard,
-- but because it committed as its OWN statement, a failure in any later write
-- left the pick CLAIMED (player_id set) with no roster row and no advance — a
-- permanently stuck draft (every retry / redelivery short-circuits on the
-- already-set player_id).
--
-- This mirrors execute_draft_pick (the manual-pick RPC) but folds the guarded
-- claim INTO the transaction: the claim, roster insert, queue cleanup, and draft
-- advance are all-or-nothing. A mid-sequence failure rolls the claim back so a
-- redelivery can re-fire; two concurrent QStash deliveries for the same pick
-- serialize on the row lock and the loser matches 0 rows (returns claimed=false)
-- instead of double-writing.
--
-- Auth is not needed: autodraft is triggered only by QStash (signature-verified)
-- and calls this with the service-role key. service_role / definer only.
--
-- Returns { claimed:false } if the pick was already taken, else
-- { claimed:true, is_complete, next_pick_number }.

CREATE OR REPLACE FUNCTION public.execute_autodraft_pick(
  p_draft_id uuid,
  p_pick_number integer,
  p_player_id uuid,
  p_league_id uuid,
  p_team_id uuid,
  p_roster_slot text,
  p_player_position text,
  p_is_rookie_draft boolean,
  p_next_time_limit integer,
  p_used_queue_entry_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_picks integer;
  v_next_pick integer;
  v_is_complete boolean;
  v_timestamp timestamptz := now();
BEGIN
  -- 1. Claim the pick — guarded so only an OPEN pick matches. Two concurrent
  --    deliveries (a late QStash timer racing the stalled-draft sweeper, or an
  --    autopick racing a human) serialize on this row lock; the loser matches
  --    0 rows and returns claimed=false without touching the roster.
  UPDATE public.draft_picks
  SET player_id = p_player_id, selected_at = v_timestamp, auto_drafted = true
  WHERE draft_id = p_draft_id AND pick_number = p_pick_number AND player_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  -- 2. Add player to roster
  INSERT INTO public.league_players (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
  VALUES (
    p_league_id, p_player_id, p_team_id,
    CASE WHEN p_is_rookie_draft THEN 'rookie_draft' ELSE 'draft' END,
    v_timestamp, p_player_position, p_roster_slot
  );

  -- 3. Remove this player from every team's queue (+ the consumed queue entry)
  DELETE FROM public.draft_queue
  WHERE draft_id = p_draft_id AND player_id = p_player_id;
  IF p_used_queue_entry_id IS NOT NULL THEN
    DELETE FROM public.draft_queue WHERE id = p_used_queue_entry_id;
  END IF;

  -- 4. Advance the draft, snapshotting the next pick's clock in the same txn
  v_next_pick := p_pick_number + 1;
  SELECT (rounds * picks_per_round) INTO v_total_picks
  FROM public.drafts WHERE id = p_draft_id;
  v_is_complete := v_next_pick > v_total_picks;

  UPDATE public.drafts
  SET current_pick_number = v_next_pick,
      current_pick_timestamp = v_timestamp,
      current_pick_time_limit = p_next_time_limit,
      status = CASE WHEN v_is_complete THEN 'complete' ELSE status END
  WHERE id = p_draft_id;

  -- 5. Rookie draft complete → advance offseason
  IF v_is_complete AND p_is_rookie_draft THEN
    UPDATE public.leagues
    SET offseason_step = 'rookie_draft_complete'
    WHERE id = p_league_id;
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'is_complete', v_is_complete,
    'next_pick_number', v_next_pick
  );
END;
$$;

-- Service-role / definer only. REVOKE from public AND from anon/authenticated:
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase's default
-- privileges grant it directly to anon/authenticated — stripping only one leaves
-- the other, so a client could still reach this SD function. (Matches the
-- create_playoff_round_atomic / finalize_keepers_atomic hardening.)
GRANT EXECUTE ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) FROM public;
REVOKE ALL ON FUNCTION public.execute_autodraft_pick(uuid, integer, uuid, uuid, uuid, text, text, boolean, integer, uuid) FROM anon, authenticated;
