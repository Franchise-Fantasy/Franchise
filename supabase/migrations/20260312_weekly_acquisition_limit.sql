-- Add weekly acquisition limit to leagues (null = unlimited)
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS weekly_acquisition_limit INT DEFAULT NULL;
