-- Fix: check constraint only allowed 'drop' and 'add_drop', but the deferred
-- transaction system also uses 'add' (pure free-agent add during game lock)
-- and 'trade' (delayed trade when players have games in progress).
ALTER TABLE pending_transactions
  DROP CONSTRAINT pending_transactions_action_type_check;

ALTER TABLE pending_transactions
  ADD CONSTRAINT pending_transactions_action_type_check
  CHECK (action_type = ANY (ARRAY['drop', 'add_drop', 'add', 'trade']));
