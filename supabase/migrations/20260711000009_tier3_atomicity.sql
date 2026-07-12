-- Tier-3 atomicity cleanups.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. One draft per (league, season, type).
--
-- Nothing enforced this, so a retried or double-tapped draft creation could
-- produce two 'initial' drafts for the same season — and every consumer does
-- `.eq('type','initial').maybeSingle()`, which then errors or silently picks
-- one. Verified 0 duplicates before adding.
CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_per_league_season_type
  ON public.drafts (league_id, season, type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. moderate_messages_apply — delete flagged messages and stamp the batch as
--    checked, together.
--
-- moderate-messages stamped `moderated_at` on every checked message FIRST and
-- deleted the flagged ones SECOND. A crash in between is the worst possible
-- outcome: the abusive message is now marked moderated, and the next run's
-- working set is `.is('moderated_at', null)` — so it is never looked at again.
-- The message survives permanently, having been "moderated".
--
-- Deleting and stamping in one transaction means the batch is either fully
-- processed or fully re-queued.
CREATE OR REPLACE FUNCTION public.moderate_messages_apply(
  p_checked_ids uuid[],
  p_flagged_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_flagged_ids IS NOT NULL AND array_length(p_flagged_ids, 1) > 0 THEN
    -- Clear read-receipt pointers first: they FK to the messages being removed.
    UPDATE chat_members SET last_read_message_id = NULL
     WHERE last_read_message_id = ANY(p_flagged_ids);

    DELETE FROM chat_messages WHERE id = ANY(p_flagged_ids);
  END IF;

  UPDATE chat_messages
     SET moderated_at = now()
   WHERE id = ANY(p_checked_ids);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. submit_survey_response — the response and its answers, together.
--
-- submit-survey inserted the response row (guarded by a UNIQUE on
-- (survey_id, team_id)) and then its answers. If the answer insert failed, the
-- response row had already committed — so the UNIQUE now permanently rejects
-- the user's retry with "You have already submitted this survey", and their
-- submission is stored with ZERO answers. They are locked out of a survey they
-- never actually completed.
CREATE OR REPLACE FUNCTION public.submit_survey_response(
  p_survey_id uuid,
  p_team_id uuid,
  p_answers jsonb                       -- [{question_id, value}]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_response_id uuid;
BEGIN
  INSERT INTO survey_responses (survey_id, team_id)
  VALUES (p_survey_id, p_team_id)
  RETURNING id INTO v_response_id;      -- 23505 here -> caller maps to 409

  IF p_answers IS NOT NULL AND jsonb_array_length(p_answers) > 0 THEN
    -- `value` is jsonb: keep it as a JSON value, don't stringify it.
    INSERT INTO survey_answers (response_id, question_id, value)
    SELECT v_response_id, (a->>'question_id')::uuid, a->'value'
      FROM jsonb_array_elements(p_answers) AS a;
  END IF;

  RETURN v_response_id;
END;
$$;

-- Both are called by edge functions (which own their auth), never by clients.
GRANT EXECUTE ON FUNCTION public.moderate_messages_apply(uuid[], uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.moderate_messages_apply(uuid[], uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.moderate_messages_apply(uuid[], uuid[]) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_survey_response(uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.submit_survey_response(uuid, uuid, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.submit_survey_response(uuid, uuid, jsonb) FROM anon, authenticated;
