-- Offline rookie drafts (dynasty leagues).
--
-- Some leagues hold their rookie draft in person or on another platform, then
-- have nowhere to record the outcome. This lets a commissioner flip a season's
-- rookie draft to "offline", enter the results by hand in a batch sheet, and
-- publish them straight onto rosters — instead of running the live in-app draft
-- room + pick clock.
--
--  * `is_offline`     — the per-draft mode flag. In-app stays the default.
--  * `offline_picks`  — scratch buffer of staged selections
--                       ([{ pick_number, player_id }]). Held OFF draft_picks on
--                       purpose so a half-finished entry can't leak into the
--                       Draft Hub (which reads draft_picks.player_id). Only a
--                       publish writes to draft_picks / rosters.
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS is_offline boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offline_picks jsonb;

-- Atomic publish / reopen for an offline draft.
--
-- The edge function resolves each pick's owning team, player position, and best
-- roster slot up front (reusing the SAME findBestSlot / isEligibleForSlot logic
-- as the live make-draft-pick path) and hands a fully-resolved pick array here,
-- so this RPC stays pure data-movement with no slot-eligibility logic to drift
-- from the TS side.
--
-- p_mode = 'publish': tear down any prior results for THIS draft (so a
--   re-publish cleanly overwrites), record each pick onto draft_picks, draft the
--   players onto their rosters (acquired_via='rookie_draft'), mark the draft
--   complete, and advance the league to 'rookie_draft_complete'.
-- p_mode = 'reopen': tear down the results and revert the draft to 'unscheduled'
--   + the league to 'rookie_draft_pending' so the commissioner can edit and
--   re-publish. The caller leaves offline_picks intact.
--
-- Both modes begin with the same teardown, so the whole thing is idempotent and
-- overwrite-safe: changing a pick and re-publishing removes the old player and
-- drafts the new one.
CREATE OR REPLACE FUNCTION public.apply_offline_draft(
  p_draft_id uuid,
  p_league_id uuid,
  p_mode text,
  p_picks jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_picks integer;
  v_pick jsonb;
  v_count integer := 0;
BEGIN
  -- Teardown (both modes): remove the players this draft previously drafted and
  -- clear its recorded picks. Matches on the picks currently stored on this
  -- draft, so nothing outside this draft is touched.
  DELETE FROM public.league_players
  WHERE league_id = p_league_id
    AND acquired_via = 'rookie_draft'
    AND player_id IN (
      SELECT player_id FROM public.draft_picks
      WHERE draft_id = p_draft_id AND player_id IS NOT NULL
    );

  UPDATE public.draft_picks
  SET player_id = NULL, selected_at = NULL
  WHERE draft_id = p_draft_id;

  IF p_mode = 'reopen' THEN
    UPDATE public.drafts
    SET status = 'unscheduled', current_pick_number = 1
    WHERE id = p_draft_id;

    UPDATE public.leagues
    SET offseason_step = 'rookie_draft_pending'
    WHERE id = p_league_id AND offseason_step = 'rookie_draft_complete';

    RETURN jsonb_build_object('mode', 'reopen', 'picks_recorded', 0);
  END IF;

  -- publish
  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_picks)
  LOOP
    UPDATE public.draft_picks
    SET player_id = (v_pick->>'player_id')::uuid, selected_at = now()
    WHERE draft_id = p_draft_id
      AND pick_number = (v_pick->>'pick_number')::integer;

    INSERT INTO public.league_players
      (league_id, player_id, team_id, acquired_via, acquired_at, position, roster_slot)
    VALUES (
      p_league_id,
      (v_pick->>'player_id')::uuid,
      (v_pick->>'team_id')::uuid,
      'rookie_draft',
      now(),
      v_pick->>'position',
      v_pick->>'roster_slot'
    );
    v_count := v_count + 1;
  END LOOP;

  SELECT (rounds * picks_per_round) INTO v_total_picks
  FROM public.drafts WHERE id = p_draft_id;

  UPDATE public.drafts
  SET status = 'complete', current_pick_number = COALESCE(v_total_picks, 0) + 1
  WHERE id = p_draft_id;

  UPDATE public.leagues
  SET offseason_step = 'rookie_draft_complete'
  WHERE id = p_league_id;

  RETURN jsonb_build_object('mode', 'publish', 'picks_recorded', v_count);
END;
$$;

-- Service-role only — reached exclusively by the offline-draft edge function,
-- which owns the commissioner check.
REVOKE ALL ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_offline_draft(uuid, uuid, text, jsonb) TO service_role;
