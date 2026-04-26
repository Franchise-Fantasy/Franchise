-- App Store Guideline 1.2 requires social apps to expose user-block, message-
-- report, and per-user mute. Existing automated content moderation (word list +
-- Claude Haiku in `moderate-messages`) covers the "filter objectionable
-- material" bullet but reviewers expect a user-initiated path too.
--
-- Two tables:
--   user_blocks      one-way blocks (blocker_id -> blocked_id)
--   message_reports  user-flagged messages, surfaced to admins + commissioner
--
-- The chat_messages SELECT policy is patched in a follow-up migration so the
-- block filter applies to direct queries; the get_messages_page RPC is also
-- patched there because it's SECURITY DEFINER and bypasses RLS.

-- ─── user_blocks ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own blocks" ON public.user_blocks;
CREATE POLICY "Users manage their own blocks" ON public.user_blocks
  FOR ALL TO authenticated
  USING (blocker_id = (SELECT auth.uid()))
  WITH CHECK (blocker_id = (SELECT auth.uid()));

-- ─── message_reports ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.message_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  reporter_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'other')),
  details      text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A given user can only report a given message once
  UNIQUE (message_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reports_open
  ON public.message_reports (created_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_message_reports_message
  ON public.message_reports (message_id);

ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;

-- Reporters insert their own reports; nothing else allowed via direct insert.
DROP POLICY IF EXISTS "Reporters can submit reports" ON public.message_reports;
CREATE POLICY "Reporters can submit reports" ON public.message_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));

-- Reporters can see their own submissions; admins and the league commissioner
-- of the conversation that owns the reported message can also read.
DROP POLICY IF EXISTS "Visible to reporter, commissioner, admin" ON public.message_reports;
CREATE POLICY "Visible to reporter, commissioner, admin" ON public.message_reports
  FOR SELECT TO authenticated
  USING (
    reporter_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_messages cm
      JOIN public.chat_conversations cc ON cc.id = cm.conversation_id
      WHERE cm.id = message_reports.message_id
        AND public.is_league_commissioner(cc.league_id)
    )
  );

-- Resolve / dismiss is restricted to admins + commissioners.
DROP POLICY IF EXISTS "Admin and commissioner can resolve" ON public.message_reports;
CREATE POLICY "Admin and commissioner can resolve" ON public.message_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_messages cm
      JOIN public.chat_conversations cc ON cc.id = cm.conversation_id
      WHERE cm.id = message_reports.message_id
        AND public.is_league_commissioner(cc.league_id)
    )
  );
