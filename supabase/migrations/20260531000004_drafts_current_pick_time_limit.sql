-- Snapshot the per-pick time limit so a mid-draft change to drafts.time_limit
-- (the commish "change pick time" control) only affects FUTURE picks — the
-- player currently on the clock keeps the limit their pick started under. Set
-- whenever a new pick begins (start-draft / execute_draft_pick path / autodraft).
-- The client countdown reads this snapshot and falls back to time_limit for safety.

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS current_pick_time_limit integer;

-- Backfill existing/in-progress drafts so the client fallback isn't needed.
UPDATE public.drafts
   SET current_pick_time_limit = time_limit
 WHERE current_pick_time_limit IS NULL;
