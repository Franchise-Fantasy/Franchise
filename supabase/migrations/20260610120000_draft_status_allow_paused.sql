-- Fix: commissioner "Pause Draft" returned 500 ("Could not pause the draft").
--
-- The 20260605000000_draft_pause migration assumed `drafts.status` had no CHECK
-- constraint ("'paused' needs no constraint change"). It does: drafts_status_check
-- allowed only unscheduled / pending / in_progress / complete. So pause-draft's
-- `UPDATE drafts SET status='paused'` tripped the constraint, threw a raw error,
-- and handleError surfaced it as a generic 500. Widen the constraint to include
-- 'paused'. Resume restores the previous status, so no other code path changes.

ALTER TABLE public.drafts DROP CONSTRAINT IF EXISTS drafts_status_check;

ALTER TABLE public.drafts
  ADD CONSTRAINT drafts_status_check
  CHECK (status = ANY (ARRAY['unscheduled'::text, 'pending'::text, 'in_progress'::text, 'paused'::text, 'complete'::text]));
