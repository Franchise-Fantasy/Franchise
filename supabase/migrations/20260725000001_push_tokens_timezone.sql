-- Per-device IANA timezone (e.g. "America/Los_Angeles"), captured at push-token
-- registration and refreshed on foreground. Lets send-notification render
-- time-bearing notification bodies (e.g. "the draft is set for {time}") in each
-- recipient's OWN zone rather than the sender's. NULL for devices on an app
-- build that predates this column (or that never re-foregrounded) — those fall
-- back to the sender-zone-labeled string the client still sends as `body`.
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS timezone text;
