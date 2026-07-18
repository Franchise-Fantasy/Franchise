-- "Fix a Pick" (commissioner tool) — free-text provenance note on a draft pick.
--
-- A trade made INSIDE the app lands in the transaction feed, so the pick's
-- history is already recorded. A pick that changed hands BEFORE an import (or
-- in a league that ran off-app) has no history anywhere — this gives the
-- commissioner somewhere to record it so the pick's origin isn't lost.
--
-- No new RLS policy: draft_picks_update (20260707154022_sec_draft_picks_lockdown)
-- already scopes writes to the league commissioner / a team's own pick, and this
-- column rides that same policy.

ALTER TABLE public.draft_picks
  ADD COLUMN IF NOT EXISTS notes text;

-- Separate from the ADD COLUMN: an inline CHECK on `ADD COLUMN IF NOT EXISTS`
-- is skipped along with the column if it already exists, which would leave the
-- bound silently unenforced on a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_picks_notes_check'
  ) THEN
    ALTER TABLE public.draft_picks
      ADD CONSTRAINT draft_picks_notes_check CHECK (char_length(notes) <= 500);
  END IF;
END $$;

COMMENT ON COLUMN public.draft_picks.notes IS
  'Commissioner-authored provenance note for a pick (e.g. an off-app trade that predates the import). Max 500 chars.';
