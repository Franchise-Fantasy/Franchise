-- Draft queue: users pre-rank players for auto-draft and suggestions
CREATE TABLE draft_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  priority int NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(draft_id, team_id, player_id)
);

CREATE INDEX idx_draft_queue_team ON draft_queue(draft_id, team_id);

ALTER TABLE draft_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own queue"
  ON draft_queue FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));
