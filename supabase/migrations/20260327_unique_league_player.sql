ALTER TABLE league_players ADD CONSTRAINT uq_league_player UNIQUE (league_id, player_id);
