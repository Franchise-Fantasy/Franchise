-- Saved drafts for commissioner-authored chat content (polls and surveys).
--
-- A survey can run to 20 questions with 10 options each, and the composer had
-- exactly one exit: publish it now, or lose it. Everything typed lived in the
-- modal's useState and was wiped by handleClose, so backing out to check a
-- rule, or being interrupted mid-compose, meant starting over. This table is
-- the "finish it later" half of that flow.
--
-- Why a separate table rather than a `status = 'draft'` column on
-- commissioner_polls / commissioner_surveys:
--   * A draft is by definition incomplete — half-typed options, no closing
--     time picked yet — and both of those tables enforce NOT NULL closes_at
--     plus length CHECKs that a work-in-progress can't satisfy.
--   * Every existing read path (the get_messages_page joins, get_poll_results,
--     the members' SELECT policies) would need a status filter added, and a
--     single missed one leaks an unpublished draft into the league's chat.
--     Here, invisibility is a property of the table, not of six predicates.
--   * Publishing stays byte-for-byte the existing create-poll / create-survey
--     edge functions — the draft is only a form-state stash.
--
-- `body` is therefore an opaque, client-owned JSON snapshot of the composer
-- form (camelCase, mirroring the modal's state) rather than typed columns.
-- Shape drift is absorbed on read by parseContentDraft* in
-- utils/chat/contentDraftBody.ts, which normalizes anything unexpected back to
-- an empty form field rather than trusting the blob.
--
-- Deliberately NOT carrying the check_blocked_content trigger the poll/survey
-- tables have: a draft is readable only by its author, and the moderation gate
-- still fires at publish time when the real row is inserted.
--
-- Named *content* drafts because `drafts` in this schema is the fantasy draft.

CREATE TABLE IF NOT EXISTS public.commissioner_content_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  -- Defaulted so the client never has to round-trip for its own user id; the
  -- RLS WITH CHECK below pins it to the caller regardless of what's sent.
  created_by      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('poll', 'survey')),
  -- A maxed-out survey (20 questions x 500-char prompt x 10 x 200-char options)
  -- is ~55 KB, so 100 KB leaves headroom while capping what one row can cost.
  body            jsonb NOT NULL CHECK (pg_column_size(body) <= 102400),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.commissioner_content_drafts IS
  'Unpublished commissioner poll/survey composer state, private to its author. Publishing goes through the create-poll / create-survey edge functions and deletes the draft; nothing here is ever visible to league members.';

-- Serves the only read: this conversation's drafts for the current user,
-- newest first. created_by is in the key because the RLS predicate filters on
-- it, so the index answers the policy too.
CREATE INDEX IF NOT EXISTS idx_content_drafts_conversation
  ON public.commissioner_content_drafts (conversation_id, created_by, updated_at DESC);

-- Covering index for the league_id FK (cascade deletes scan by it).
CREATE INDEX IF NOT EXISTS idx_content_drafts_league
  ON public.commissioner_content_drafts (league_id);

ALTER TABLE public.commissioner_content_drafts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commissioner_content_drafts TO authenticated;
REVOKE ALL ON public.commissioner_content_drafts FROM anon;

-- Own drafts, and only in a league you actually run. `leagues.created_by` is
-- qualified because an unqualified `created_by` inside the subquery would
-- resolve to the leagues column anyway — spelling it out keeps the two
-- same-named columns from reading as a bug. `(SELECT auth.uid())` so the uid
-- is evaluated once per statement instead of once per row.
DROP POLICY IF EXISTS "Commissioners manage their own content drafts" ON public.commissioner_content_drafts;
CREATE POLICY "Commissioners manage their own content drafts" ON public.commissioner_content_drafts
  FOR ALL TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    AND league_id IN (
      SELECT leagues.id FROM public.leagues WHERE leagues.created_by = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND league_id IN (
      SELECT leagues.id FROM public.leagues WHERE leagues.created_by = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- updated_at is what the drafts list sorts on, so it can't be left to the
-- client to remember on every save.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_content_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_drafts_touch ON public.commissioner_content_drafts;
CREATE TRIGGER trg_content_drafts_touch
  BEFORE UPDATE ON public.commissioner_content_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_content_draft();

-- ---------------------------------------------------------------------------
-- Per-league cap. The client only ever updates the draft it has open, so this
-- is a backstop against a loop that inserts instead of updating — without it
-- the table is an unbounded, user-writable blob store. 25 is far past any real
-- workflow and still keeps the list a single short read (well under the
-- PostgREST max_rows truncation point).
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (the default) on purpose: the count runs under the caller's
-- RLS, which restricts it to that commissioner's own drafts — exactly what the
-- cap is counting.
CREATE OR REPLACE FUNCTION public.enforce_content_draft_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.commissioner_content_drafts
    WHERE created_by = NEW.created_by AND league_id = NEW.league_id
  ) >= 25 THEN
    RAISE EXCEPTION 'Draft limit reached — delete a saved draft before saving another.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_drafts_cap ON public.commissioner_content_drafts;
CREATE TRIGGER trg_content_drafts_cap
  BEFORE INSERT ON public.commissioner_content_drafts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_draft_cap();
