-- Optimize draft_queue RLS policy: wrap auth.uid() in a subselect so it
-- evaluates once per query instead of once per row.
DROP POLICY IF EXISTS "Users can manage their own queue" ON draft_queue;

CREATE POLICY "Users can manage their own queue"
  ON draft_queue FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE user_id = (SELECT auth.uid())));
