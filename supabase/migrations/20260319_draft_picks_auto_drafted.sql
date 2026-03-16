-- Track whether a pick was made by autodraft (for consecutive autodraft speedup)
ALTER TABLE draft_picks ADD COLUMN auto_drafted boolean NOT NULL DEFAULT false;
