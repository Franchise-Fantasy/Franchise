-- Stores per-team presence heartbeat + manual autopick toggle for drafts.
-- The autodraft edge function reads this to decide between a 1s cascade
-- delay and the full timer. Clients write heartbeats every 30s while in
-- the draft room.

CREATE TABLE draft_team_status (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id     uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  autopick_on  boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, team_id)
);

CREATE INDEX idx_dts_draft ON draft_team_status(draft_id);

ALTER TABLE draft_team_status ENABLE ROW LEVEL SECURITY;

-- Team owners can read and write their own row
CREATE POLICY "Team owners manage own draft status"
  ON draft_team_status FOR ALL
  USING (
    team_id IN (
      SELECT t.id FROM teams t WHERE t.user_id = auth.uid()
    )
  );

-- All league members can read (used for presence display)
CREATE POLICY "League members can read draft team status"
  ON draft_team_status FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN teams t ON t.league_id = d.league_id
      WHERE d.id = draft_team_status.draft_id
        AND t.user_id = auth.uid()
    )
  );
