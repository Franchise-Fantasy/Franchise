-- Add metadata column to pending_transactions for storing trade proposal_id etc.
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
