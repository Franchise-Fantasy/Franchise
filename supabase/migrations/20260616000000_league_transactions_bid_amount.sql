-- Store the winning FAAB bid on the waiver transaction so the activity feed can
-- surface it. The amount already lived only inside the free-text `notes`, which
-- TransactionCard suppresses in favor of per-item "Added/Dropped" lines, so the
-- bid never reached the UI. NULL for standard-waiver / instant free-agent moves.
ALTER TABLE league_transactions
  ADD COLUMN IF NOT EXISTS bid_amount integer;
