-- Atomic season rollover. advance-season ran ~12 independent writes:
--   archive team_seasons → ZERO every team's W/L/PF/PA → cancel trades/claims/txns
--   → clear waivers → refill FAAB → re-seed waiver priority → (redraft) delete all
--   rosters → (dynasty) seed/renumber draft picks → promote aged-out taxi players
--   → finally UPDATE leagues (season, champion, offseason_step)
--
-- The re-entry gate is `leagues.offseason_step IS NULL`, and it only flips in that
-- LAST write. But team stats are zeroed near the START. So any failure in between
-- left the gate OPEN with the standings already destroyed, and the commissioner's
-- retry would:
--   * re-read teams (now all zeros),
--   * re-upsert team_seasons ON CONFLICT (team_id, season) — overwriting the good
--     archive with an all-zero record and a meaningless final_standing, and
--   * re-derive the rookie-draft slot order and waiver priority from that garbage
--     ordering.
-- Unrecoverable without hand-repairing the season archive.
--
-- All the judgment (bracket → champion/runner-up/eliminations, win-pct standings
-- sort, random-vs-reverse waiver order, taxi aging) stays in TypeScript and is
-- passed in pre-computed; this function only APPLIES the writes, together, so a
-- failure rolls back the zeroing too and a retry sees the real standings again.
--
-- The gate is re-checked under FOR UPDATE, which also serializes two concurrent
-- advance calls (the loser gets unique_violation → 409).

CREATE OR REPLACE FUNCTION public.advance_season_atomic(
  p_league_id uuid,
  p_team_seasons jsonb,        -- archive rows (already ranked + playoff-tagged)
  p_team_ids uuid[],           -- teams whose season stats get reset
  p_league_updates jsonb,      -- season, champion_team_id, offseason_step, ...
  p_faab_budget integer,
  p_waiver_order uuid[],       -- NULL = 'keep' (leave rolling priority untouched)
  p_is_redraft boolean,
  p_new_season text,
  p_new_picks jsonb,           -- dynasty: picks to INSERT   (may be [])
  p_pick_updates jsonb,        -- dynasty: picks to RENUMBER  (may be [])
  p_taxi_promote_ids uuid[],   -- league_players rows aging off the taxi squad
  p_taxi_transactions jsonb    -- ledger entries for those promotions (may be [])
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step text;
BEGIN
  -- Race-safe gate. The edge function checks this up front for a friendly error;
  -- re-checking under FOR UPDATE closes the gap between that read and these writes.
  SELECT offseason_step INTO v_step FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league % not found', p_league_id;
  END IF;
  IF v_step IS NOT NULL THEN
    RAISE EXCEPTION 'league % is already in the offseason', p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 1. Archive the completed season.
  INSERT INTO team_seasons (
    team_id, league_id, season, team_name, wins, losses, ties,
    points_for, points_against, final_standing, playoff_result
  )
  SELECT (t->>'team_id')::uuid, p_league_id, (t->>'season')::text, t->>'team_name',
         (t->>'wins')::integer, (t->>'losses')::integer, (t->>'ties')::integer,
         (t->>'points_for')::numeric, (t->>'points_against')::numeric,
         (t->>'final_standing')::integer, t->>'playoff_result'
  FROM jsonb_array_elements(COALESCE(p_team_seasons, '[]'::jsonb)) AS t
  ON CONFLICT (team_id, season) DO UPDATE SET
    team_name      = EXCLUDED.team_name,
    wins           = EXCLUDED.wins,
    losses         = EXCLUDED.losses,
    ties           = EXCLUDED.ties,
    points_for     = EXCLUDED.points_for,
    points_against = EXCLUDED.points_against,
    final_standing = EXCLUDED.final_standing,
    playoff_result = EXCLUDED.playoff_result;

  -- 2. Reset team stats for the new season (the write that used to strand the
  --    standings when a later step failed).
  UPDATE teams
  SET wins = 0, losses = 0, ties = 0, points_for = 0, points_against = 0, streak = ''
  WHERE id = ANY(p_team_ids);

  -- 3. Cancel anything still in flight from last season.
  UPDATE trade_proposals SET status = 'cancelled'
  WHERE league_id = p_league_id AND status IN ('pending', 'accepted', 'in_review');

  UPDATE waiver_claims SET status = 'cancelled'
  WHERE league_id = p_league_id AND status = 'pending';

  UPDATE pending_transactions SET status = 'cancelled'
  WHERE league_id = p_league_id AND status = 'pending';

  DELETE FROM league_waivers WHERE league_id = p_league_id;

  -- 4. FAAB refills every season regardless of the priority-reset policy.
  UPDATE waiver_priority SET faab_remaining = p_faab_budget WHERE league_id = p_league_id;

  IF p_waiver_order IS NOT NULL THEN
    UPDATE waiver_priority wp
    SET priority = o.ord
    FROM unnest(p_waiver_order) WITH ORDINALITY AS o(team_id, ord)
    WHERE wp.league_id = p_league_id AND wp.team_id = o.team_id;
  END IF;

  -- 5. Redraft: everyone back to the free-agent pool.
  IF p_is_redraft THEN
    DELETE FROM league_players WHERE league_id = p_league_id;
    DELETE FROM draft_picks WHERE league_id = p_league_id AND draft_id IS NULL;
  END IF;

  -- 6. Dynasty: seed next season's rookie picks, or renumber the existing ones.
  --    Slot order keys off original_team_id — a traded pick must take the slot of
  --    the team that ORIGINATED it, not whoever currently holds it.
  IF jsonb_array_length(COALESCE(p_new_picks, '[]'::jsonb)) > 0 THEN
    INSERT INTO draft_picks (
      league_id, season, round, slot_number, pick_number, current_team_id, original_team_id
    )
    SELECT p_league_id, p_new_season, (p->>'round')::integer, (p->>'slot_number')::integer,
           (p->>'pick_number')::integer, (p->>'current_team_id')::uuid, (p->>'original_team_id')::uuid
    FROM jsonb_array_elements(p_new_picks) AS p;
  END IF;

  IF jsonb_array_length(COALESCE(p_pick_updates, '[]'::jsonb)) > 0 THEN
    UPDATE draft_picks dp
    SET pick_number = (u->>'pick_number')::integer,
        slot_number = (u->>'slot_number')::integer
    FROM jsonb_array_elements(p_pick_updates) AS u
    WHERE dp.league_id = p_league_id
      AND dp.season = p_new_season
      AND dp.round = (u->>'round')::integer
      AND dp.original_team_id = (u->>'original_team_id')::uuid
      AND dp.draft_id IS NULL;
  END IF;

  -- 7. Taxi squad: promote players who aged out, and log it.
  IF p_taxi_promote_ids IS NOT NULL AND array_length(p_taxi_promote_ids, 1) > 0 THEN
    UPDATE league_players
    SET roster_slot = 'BE', promoted_from_taxi = true
    WHERE id = ANY(p_taxi_promote_ids);
  END IF;

  IF jsonb_array_length(COALESCE(p_taxi_transactions, '[]'::jsonb)) > 0 THEN
    INSERT INTO league_transactions (league_id, type, team_id, notes)
    SELECT p_league_id, 'commissioner', (x->>'team_id')::uuid, x->>'notes'
    FROM jsonb_array_elements(p_taxi_transactions) AS x;
  END IF;

  -- 8. Flip the league into the offseason. Same transaction as the reset above, so
  --    a failure anywhere here rolls the zeroed standings back with it.
  UPDATE leagues
  SET champion_team_id   = (p_league_updates->>'champion_team_id')::uuid,
      season             = p_league_updates->>'season',
      schedule_generated = (p_league_updates->>'schedule_generated')::boolean,
      lottery_status     = p_league_updates->>'lottery_status',
      lottery_date       = (p_league_updates->>'lottery_date')::timestamptz,
      offseason_step     = p_league_updates->>'offseason_step'
  WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'archived', jsonb_array_length(COALESCE(p_team_seasons, '[]'::jsonb)),
    'offseason_step', p_league_updates->>'offseason_step'
  );
END;
$$;

-- Service-role / definer only (the edge function owns the commissioner check).
GRANT EXECUTE ON FUNCTION public.advance_season_atomic(uuid, jsonb, uuid[], jsonb, integer, uuid[], boolean, text, jsonb, jsonb, uuid[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.advance_season_atomic(uuid, jsonb, uuid[], jsonb, integer, uuid[], boolean, text, jsonb, jsonb, uuid[], jsonb) FROM public;
REVOKE ALL ON FUNCTION public.advance_season_atomic(uuid, jsonb, uuid[], jsonb, integer, uuid[], boolean, text, jsonb, jsonb, uuid[], jsonb) FROM anon, authenticated;
