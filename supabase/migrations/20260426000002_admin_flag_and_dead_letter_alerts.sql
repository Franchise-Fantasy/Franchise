-- Adds admin flagging on profiles + dead_letter_alerts audit table.
-- queue-worker reads is_admin and push_tokens to page admins on dead-letter.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Bootstrap: seed Joe as admin (idempotent — safe to re-run)
UPDATE public.profiles
   SET is_admin = true
 WHERE email = 'jjspoels@gmail.com'
   AND NOT is_admin;

CREATE TABLE IF NOT EXISTS public.dead_letter_alerts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  original_queue  text NOT NULL,
  original_msg_id bigint NOT NULL,
  function_name   text,
  reason          text NOT NULL,
  payload         jsonb,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_alerts_unresolved
  ON public.dead_letter_alerts(created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.dead_letter_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read dead letter alerts" ON public.dead_letter_alerts;
CREATE POLICY "Admins can read dead letter alerts" ON public.dead_letter_alerts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_admin = true
  ));

DROP POLICY IF EXISTS "Admins can resolve dead letter alerts" ON public.dead_letter_alerts;
CREATE POLICY "Admins can resolve dead letter alerts" ON public.dead_letter_alerts
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_admin = true
  ));
