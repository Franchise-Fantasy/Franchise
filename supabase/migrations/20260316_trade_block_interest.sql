ALTER TABLE league_players
ADD COLUMN trade_block_interest uuid[] NOT NULL DEFAULT '{}';
