-- Deferred lottery resolution. start-lottery now computes the full resolution
-- (final slots, owners, protection/swap outcomes) but does NOT mutate
-- draft_picks/pick_swaps — it STAGES the result here. The picks stay in their
-- pre-lottery state (odds + pending conditions everywhere) until the
-- commissioner taps "Done", at which point create-rookie-draft applies these
-- assignments and creates the draft. This removes the confusing
-- "drawn-but-not-finalized" limbo where the draft hub showed resolved results
-- before the lottery was actually committed.
--
-- Shape: { picks: [{ id, round, original_team_id, slot_number, pick_number,
--          current_team_id }], swaps_resolved: [swap_id, ...] }

ALTER TABLE public.lottery_results
  ADD COLUMN IF NOT EXISTS pick_assignments jsonb;
