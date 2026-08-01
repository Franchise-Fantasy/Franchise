-- Redraft/keeper leagues get a real, dormant offseason instead of a broken one.
--
-- The problem this fixes has two halves.
--
-- (1) FRAMING. A redraft league that finished its season was dropped straight
--     into 'ready_for_new_season' — the dynasty offseason machine with the
--     dynasty parts removed. The home hero said "Draft." and offered a Create
--     Draft button, but the incoming rookie class isn't in `players` until that
--     sport's real draft happens (NBA ~Jul 1, NFL ~May 1, WNBA ~Apr 20 — the
--     dates already encoded in season_config.creation_opens_at). Drafting
--     before then drafts LAST year's rookies. The gap is months: a WNBA league
--     ending in September waits until the following April.
--
-- (2) THE DRAFT WAS BROKEN ANYWAY. The client's "Create Draft" action inserted
--     a bare `drafts` row and nothing else — no draft_picks, `rounds` set to
--     the team count instead of roster_size, `picks_per_round` left NULL. With
--     picks_per_round NULL, make-draft-pick's `current_pick_number > rounds *
--     picks_per_round` guard evaluates against 0 and every pick returns "Draft
--     is already complete." Two live leagues are sitting in that state.
--
-- The new model: a redraft/keeper league lands in 'offseason' (dormant — history
-- and standings only), and the `open-draft-season` cron flips it to
-- 'ready_for_new_season' once the rookie gate passes, creating the draft
-- correctly at the same time. Dynasty is untouched here; its rookie draft has
-- the same rookie-class constraint and is a tracked follow-up.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Allow the dormant step.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_offseason_step_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_offseason_step_check
  CHECK (
    offseason_step IS NULL OR offseason_step = ANY (ARRAY[
      'offseason'::text,
      'lottery_pending'::text,
      'lottery_scheduled'::text,
      'lottery_revealing'::text,
      'lottery_complete'::text,
      'rookie_draft_pending'::text,
      'rookie_draft_complete'::text,
      'keeper_pending'::text,
      'ready_for_new_season'::text
    ])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. finalize_keepers_atomic: the next step is now the caller's call.
--    Keeper declarations don't need the rookie class (you're keeping players
--    you already have), so keepers are finalized during dormancy and the league
--    drops back to 'offseason' until the draft gate opens. The edge function
--    resolves which step that is; the default keeps the old behaviour for any
--    caller that doesn't pass one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_keepers_atomic(
  p_league_id uuid,
  p_season text,
  p_next_step text DEFAULT 'ready_for_new_season'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offseason_step text;
  v_league_type text;
  v_kept_count integer;
  v_released_count integer;
BEGIN
  IF p_next_step NOT IN ('offseason', 'ready_for_new_season') THEN
    RAISE EXCEPTION 'invalid next step %', p_next_step;
  END IF;

  -- Lock the league and re-check state inside the txn (race-safe backstop; the
  -- edge function does the friendly-error version of these checks up front).
  SELECT offseason_step, league_type
    INTO v_offseason_step, v_league_type
  FROM leagues
  WHERE id = p_league_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'league % not found', p_league_id;
  END IF;

  IF v_league_type <> 'keeper' THEN
    RAISE EXCEPTION 'league % is not a keeper league', p_league_id;
  END IF;

  IF v_offseason_step IS DISTINCT FROM 'keeper_pending' THEN
    RAISE EXCEPTION 'league % is not in the keeper declaration phase', p_league_id;
  END IF;

  SELECT count(*) INTO v_kept_count
  FROM keeper_declarations
  WHERE league_id = p_league_id AND season = p_season;

  -- Release every rostered player that isn't a declared keeper. NOT EXISTS is
  -- null-safe and naturally releases the whole roster when zero keepers were
  -- declared (the original code's explicit no-keepers branch).
  WITH released AS (
    DELETE FROM league_players lp
    WHERE lp.league_id = p_league_id
      AND NOT EXISTS (
        SELECT 1 FROM keeper_declarations kd
        WHERE kd.league_id = p_league_id
          AND kd.season = p_season
          AND kd.player_id = lp.player_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_released_count FROM released;

  DELETE FROM keeper_declarations
  WHERE league_id = p_league_id AND season = p_season;

  UPDATE leagues
  SET offseason_step = p_next_step
  WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'kept_count', v_kept_count,
    'released_count', v_released_count
  );
END;
$$;

-- Internal helper: no auth check of its own (the edge function gates the call),
-- so only the service_role / definer may reach it. REVOKE FROM anon,
-- authenticated does NOT strip the implicit PUBLIC grant — revoke that too.
REVOKE ALL ON FUNCTION public.finalize_keepers_atomic(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_keepers_atomic(uuid, text, text) FROM anon, authenticated;

-- The 2-arg signature is now unreachable (the edge function passes three), and
-- leaving it around would let a caller land on the old hardcoded behaviour.
DROP FUNCTION IF EXISTS public.finalize_keepers_atomic(uuid, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. create_season_draft_atomic — build a season draft and open the league in
--    one transaction.
--
--    Split writes are what produced the broken state in the first place: a
--    `drafts` row with no picks is worse than no draft at all, because the UI
--    reads it as "draft exists, go schedule it" and every pick then fails. The
--    draft row, its full pick board, the slot assignment, and the offseason_step
--    flip commit together or not at all.
--
--    Heals as well as creates: a draft that already exists for this season but
--    has no picks (the leagues stranded by the old client path) gets its picks
--    and its rounds/picks_per_round corrected rather than a second draft.
--
--    p_slot_team_ids is the slot order, 1-indexed by array position; pass NULL
--    for a manual-order league so the commissioner assigns it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_season_draft_atomic(
  p_league_id uuid,
  p_season text,
  p_rounds integer,
  p_picks_per_round integer,
  p_draft_type text,
  p_time_limit integer,
  p_picks jsonb,               -- [{round, slot_number, pick_number}]
  p_slot_team_ids uuid[]       -- slot order, or NULL to leave unassigned
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step text;
  v_league_type text;
  v_draft_id uuid;
  v_pick_count integer;
  v_created boolean := false;
BEGIN
  SELECT offseason_step, league_type INTO v_step, v_league_type
  FROM leagues WHERE id = p_league_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'league % not found', p_league_id;
  END IF;

  -- Only the two types that draft a fresh roster each year come through here.
  -- A dynasty league's next draft is its rookie draft (create-rookie-draft).
  IF v_league_type NOT IN ('redraft', 'keeper') THEN
    RAISE EXCEPTION 'league % is not a redraft or keeper league', p_league_id;
  END IF;

  -- Race gate: another run (or the commissioner) already opened this league.
  IF v_step IS DISTINCT FROM 'offseason' AND v_step IS DISTINCT FROM 'ready_for_new_season' THEN
    RAISE EXCEPTION 'league % is not awaiting its season draft (step %)', p_league_id, v_step
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT id INTO v_draft_id
  FROM drafts
  WHERE league_id = p_league_id AND season = p_season AND type = 'initial'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_draft_id IS NULL THEN
    INSERT INTO drafts (
      league_id, season, type, status, rounds, picks_per_round,
      time_limit, draft_type, current_pick_number
    )
    VALUES (
      p_league_id, p_season, 'initial', 'unscheduled', p_rounds, p_picks_per_round,
      p_time_limit, p_draft_type, 1
    )
    RETURNING id INTO v_draft_id;
    v_created := true;
  ELSE
    SELECT count(*) INTO v_pick_count FROM draft_picks WHERE draft_id = v_draft_id;

    -- A draft that already has its board is left completely alone — it may be
    -- scheduled, in progress, or mid-way through picks.
    IF v_pick_count > 0 THEN
      UPDATE leagues SET offseason_step = 'ready_for_new_season' WHERE id = p_league_id;
      RETURN jsonb_build_object('draft_id', v_draft_id, 'created', false, 'healed', false);
    END IF;

    -- Board-less shell from the old client path: correct it in place.
    UPDATE drafts
    SET rounds = p_rounds,
        picks_per_round = p_picks_per_round,
        draft_type = p_draft_type,
        time_limit = p_time_limit,
        current_pick_number = 1
    WHERE id = v_draft_id;
  END IF;

  INSERT INTO draft_picks (
    league_id, draft_id, season, round, slot_number, pick_number,
    current_team_id, original_team_id
  )
  SELECT
    p_league_id,
    v_draft_id,
    p_season,
    (p->>'round')::integer,
    (p->>'slot_number')::integer,
    (p->>'pick_number')::integer,
    CASE WHEN p_slot_team_ids IS NULL THEN NULL
         ELSE p_slot_team_ids[(p->>'slot_number')::integer] END,
    CASE WHEN p_slot_team_ids IS NULL THEN NULL
         ELSE p_slot_team_ids[(p->>'slot_number')::integer] END
  FROM jsonb_array_elements(p_picks) AS p;

  UPDATE leagues SET offseason_step = 'ready_for_new_season' WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'draft_id', v_draft_id,
    'created', v_created,
    'healed', NOT v_created
  );
END;
$$;

-- Service-role only: the cron edge function is the sole caller and does its own
-- gating. PUBLIC carries anon, so revoke it explicitly alongside the roles.
REVOKE ALL ON FUNCTION public.create_season_draft_atomic(uuid, text, integer, integer, text, integer, jsonb, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_season_draft_atomic(uuid, text, integer, integer, text, integer, jsonb, uuid[]) FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Harden assign_initial_draft_slots against a second 'initial' draft.
--
--     It picks its target with `WHERE type='initial' LIMIT 1` and no ORDER BY.
--     That was unambiguous when a league had exactly one initial draft ever —
--     but a redraft/keeper league now gets a fresh one every season, so the
--     unordered pick can land on EITHER. Landing on the old one makes it no-op
--     (harmless); landing on the new one re-randomizes slots that
--     create_season_draft_atomic just assigned — silently destroying a
--     reverse-standings order.
--
--     Two fixes: target the CURRENT season's draft, and don't run at all once
--     the league is in an offseason. The offseason check is the real guard:
--     during an offseason the draft order is DELIBERATE (drawn by the lottery
--     for dynasty, or by create_season_draft_atomic for redraft/keeper), and a
--     member joining must never re-roll it. A first-ever draft has
--     offseason_step IS NULL, so the original behaviour is untouched.
--
--     Note what we deliberately do NOT guard on: "picks already have a
--     current_team_id". join_league_team tentatively claims each joiner's
--     join-order slot, expecting THIS function to overwrite it when the league
--     fills — so bailing on an assigned board would stop the real order from
--     ever being drawn on a brand-new league.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_initial_draft_slots(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order text;
  v_league_size int;
  v_season text;
  v_step text;
  v_team_count int;
  v_draft_id uuid;
  v_team_ids uuid[];
BEGIN
  IF NOT is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  SELECT initial_draft_order, teams, season, offseason_step
    INTO v_order, v_league_size, v_season, v_step
  FROM leagues WHERE id = p_league_id;

  IF v_step IS NOT NULL THEN RETURN; END IF;              -- offseason order is deliberate
  IF v_order = 'manual' THEN RETURN; END IF;              -- commissioner sets order manually

  SELECT count(*) INTO v_team_count FROM teams WHERE league_id = p_league_id;
  IF v_team_count < v_league_size THEN RETURN; END IF;    -- not full yet

  SELECT id INTO v_draft_id
  FROM drafts
  WHERE league_id = p_league_id AND type = 'initial' AND season = v_season
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_draft_id IS NULL THEN RETURN; END IF;

  -- Never reshuffle a draft that has already started.
  IF EXISTS (SELECT 1 FROM draft_picks WHERE draft_id = v_draft_id AND selected_at IS NOT NULL) THEN
    RETURN;
  END IF;

  -- One shuffle, reused for the initial draft picks and the future-season
  -- placeholder picks so both share the same slot order.
  SELECT array_agg(id ORDER BY random()) INTO v_team_ids
  FROM teams WHERE league_id = p_league_id;

  UPDATE draft_picks dp
  SET current_team_id = v_team_ids[dp.slot_number],
      original_team_id = v_team_ids[dp.slot_number]
  WHERE dp.draft_id = v_draft_id
    AND dp.slot_number BETWEEN 1 AND array_length(v_team_ids, 1);

  UPDATE draft_picks dp
  SET current_team_id = v_team_ids[dp.slot_number],
      original_team_id = v_team_ids[dp.slot_number]
  WHERE dp.league_id = p_league_id
    AND dp.draft_id IS NULL
    AND dp.slot_number BETWEEN 1 AND array_length(v_team_ids, 1);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_initial_draft_slots(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Move already-advanced redraft/keeper leagues into the dormant step.
--
--    Deliberately narrow: only leagues whose season draft hasn't actually been
--    built yet. A league sitting at 'ready_for_new_season' with a real pick
--    board is mid-flight and must not be dragged backwards. The cron re-opens
--    each of these (creating the draft) the moment its rookie gate passes, so a
--    league whose gate is already behind it is dormant for at most one day.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE leagues l
SET offseason_step = 'offseason'
WHERE l.offseason_step = 'ready_for_new_season'
  AND l.league_type IN ('redraft', 'keeper')
  AND NOT EXISTS (
    SELECT 1
    FROM drafts d
    JOIN draft_picks dp ON dp.draft_id = d.id
    WHERE d.league_id = l.id AND d.season = l.season AND d.type = 'initial'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The gate driver. Daily, mid-morning UTC — the rookie gate is a date, so
--    minutes don't matter, and every sport's sync-players run (19:0x UTC) has
--    long since landed the class by the next morning.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.cron_job_runs (job_name, expected_interval)
VALUES ('open-draft-season', interval '1 day')
ON CONFLICT (job_name) DO NOTHING;

SELECT cron.unschedule('open-draft-season')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'open-draft-season');

SELECT cron.schedule(
  'open-draft-season',
  '40 10 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/open-draft-season',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
