-- Add player lock type setting to leagues.
-- 'daily'      = ESPN-style: once first game tips off, adds queue to next day
-- 'individual' = block add only when involved player's game has started
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS player_lock_type text NOT NULL DEFAULT 'daily';
