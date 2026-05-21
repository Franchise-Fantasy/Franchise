-- Persist what happened to protected/conveyed picks and pick swaps when the
-- lottery resolves. start-lottery mutates draft_picks in place (clearing
-- protection columns) and marks pick_swaps resolved, so after the draw there
-- is no durable record of WHY ownership changed. This column captures a
-- structured, human-readable resolution log at draw time so the lottery-room
-- (immediately post-reveal) and the draft hub (collapsible, all offseason)
-- can show "what changed" without re-deriving it from destroyed state.
--
-- Shape: jsonb array of events, each { kind, round, ... } where kind is one of
-- 'protected' | 'conveyed' | 'swap_executed' | 'swap_voided'. Nullable so old
-- rows (and any future no-op draws) simply carry no log.

ALTER TABLE public.lottery_results
  ADD COLUMN IF NOT EXISTS pick_resolution jsonb;
