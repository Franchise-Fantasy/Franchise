-- Add logo_key column to teams for preset icon selection.
-- Stores a key like "wolf" or "phoenix" mapping to a bundled preset icon.
-- Future: "custom:<uuid>" pattern for user-uploaded logos with moderation.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo_key text;
