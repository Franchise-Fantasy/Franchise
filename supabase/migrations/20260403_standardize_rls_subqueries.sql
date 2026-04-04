-- Standardize inline RLS subqueries to use (SELECT auth.uid()) pattern.
-- Policies using raw auth.uid() in subqueries against the teams table
-- force Postgres to re-evaluate the JWT claim per row. Wrapping in
-- (SELECT ...) lets the planner evaluate it once per statement.

-- ─── league_payments ─────────────────────────────────────────

DROP POLICY IF EXISTS "Team owners can self-report payment" ON league_payments;
CREATE POLICY "Team owners can self-report payment" ON league_payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = league_payments.team_id
        AND teams.user_id = (SELECT auth.uid())
    )
  ) WITH CHECK (
    status = 'self_reported'
    AND EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = league_payments.team_id
        AND teams.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Team owners can insert self-report" ON league_payments;
CREATE POLICY "Team owners can insert self-report" ON league_payments
  FOR INSERT WITH CHECK (
    status = 'self_reported'
    AND EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = league_payments.team_id
        AND teams.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "League members can read payments" ON league_payments;
CREATE POLICY "League members can read payments" ON league_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = league_payments.league_id
        AND teams.user_id = (SELECT auth.uid())
    )
  );

-- ─── chat_pins ───────────────────────────────────────────────

DROP POLICY IF EXISTS "Members can read pins" ON chat_pins;
CREATE POLICY "Members can read pins" ON chat_pins
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.conversation_id = chat_pins.conversation_id
        AND cm.team_id IN (
          SELECT t.id FROM teams t WHERE t.user_id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Commissioner can pin" ON chat_pins;
CREATE POLICY "Commissioner can pin" ON chat_pins
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations cc
      JOIN leagues l ON l.id = cc.league_id
      WHERE cc.id = chat_pins.conversation_id
        AND l.created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Commissioner can unpin" ON chat_pins;
CREATE POLICY "Commissioner can unpin" ON chat_pins
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM chat_conversations cc
      JOIN leagues l ON l.id = cc.league_id
      WHERE cc.id = chat_pins.conversation_id
        AND l.created_by = (SELECT auth.uid())
    )
  );

-- ─── draft_team_status ───────────────────────────────────────

DROP POLICY IF EXISTS "League members can read draft team status" ON draft_team_status;
CREATE POLICY "League members can read draft team status" ON draft_team_status
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN teams t ON t.league_id = d.league_id
      WHERE d.id = draft_team_status.draft_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Team owners manage own draft status" ON draft_team_status;
CREATE POLICY "Team owners manage own draft status" ON draft_team_status
  FOR ALL USING (
    team_id IN (
      SELECT t.id FROM teams t WHERE t.user_id = (SELECT auth.uid())
    )
  );

-- ─── commissioner_surveys ────────────────────────────────────

DROP POLICY IF EXISTS "League members can read surveys" ON commissioner_surveys;
CREATE POLICY "League members can read surveys" ON commissioner_surveys
  FOR SELECT USING (
    league_id IN (
      SELECT teams.league_id FROM teams WHERE teams.user_id = (SELECT auth.uid())
    )
  );

-- ─── survey_responses ────────────────────────────────────────

DROP POLICY IF EXISTS "Members can read own survey responses" ON survey_responses;
CREATE POLICY "Members can read own survey responses" ON survey_responses
  FOR SELECT USING (
    team_id IN (
      SELECT teams.id FROM teams WHERE teams.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Commissioner can read all survey responses" ON survey_responses;
CREATE POLICY "Commissioner can read all survey responses" ON survey_responses
  FOR SELECT USING (
    survey_id IN (
      SELECT cs.id FROM commissioner_surveys cs
      JOIN leagues l ON l.id = cs.league_id
      WHERE l.created_by = (SELECT auth.uid())
    )
  );

-- ─── survey_answers ──────────────────────────────────────────

DROP POLICY IF EXISTS "Members can read own survey answers" ON survey_answers;
CREATE POLICY "Members can read own survey answers" ON survey_answers
  FOR SELECT USING (
    response_id IN (
      SELECT survey_responses.id FROM survey_responses
      WHERE survey_responses.team_id IN (
        SELECT teams.id FROM teams WHERE teams.user_id = (SELECT auth.uid())
      )
    )
  );

-- ─── survey_questions ────────────────────────────────────────

DROP POLICY IF EXISTS "League members can read survey questions" ON survey_questions;
CREATE POLICY "League members can read survey questions" ON survey_questions
  FOR SELECT USING (
    survey_id IN (
      SELECT commissioner_surveys.id FROM commissioner_surveys
      WHERE commissioner_surveys.league_id IN (
        SELECT teams.league_id FROM teams WHERE teams.user_id = (SELECT auth.uid())
      )
    )
  );

-- ─── subscription_events ─────────────────────────────────────

DROP POLICY IF EXISTS "Users can read own subscription events" ON subscription_events;
CREATE POLICY "Users can read own subscription events" ON subscription_events
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- ─── league_notification_prefs ───────────────────────────────

DROP POLICY IF EXISTS "Users can manage their own league notification prefs" ON league_notification_prefs;
CREATE POLICY "Users can manage their own league notification prefs" ON league_notification_prefs
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
