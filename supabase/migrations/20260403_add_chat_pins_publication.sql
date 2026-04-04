-- Add chat_pins to the scoped realtime publication so the
-- usePinnedMessages hook actually receives changes.
-- (chat_pins was added after the publication was scoped in
-- 20260324_scope_realtime_publication.sql)

ALTER PUBLICATION supabase_realtime ADD TABLE chat_pins;
