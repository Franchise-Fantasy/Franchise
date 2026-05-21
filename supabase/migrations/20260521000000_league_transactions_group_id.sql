-- Link related transactions (e.g. an add and its forced drop done in one user
-- action) so the activity feed can render them as a single grouped card.
-- Nullable + purely additive: every existing read path keeps working, and the
-- one-row-per-event integrity (acquisition-limit counts, player history, waiver
-- logging) is untouched. Rows sharing a non-null group_id are merged for display
-- only; the cron-executed drop side carries the same group_id via its
-- pending_transactions.metadata payload.
ALTER TABLE public.league_transactions
  ADD COLUMN IF NOT EXISTS group_id uuid;
