-- Support multiple drops per team in trades (e.g., team gains 3 players but
-- only has room for 1 → needs to drop 2). The old single-uuid column couldn't
-- handle this, causing trades to get stuck in pending_drops forever.

ALTER TABLE trade_proposal_teams
  ADD COLUMN drop_player_ids uuid[] DEFAULT '{}';

-- Backfill from the old single column
UPDATE trade_proposal_teams
SET drop_player_ids = ARRAY[drop_player_id]
WHERE drop_player_id IS NOT NULL;

ALTER TABLE trade_proposal_teams
  DROP COLUMN drop_player_id;
