-- Commissioner payment handles on leagues table
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS venmo_username text,
  ADD COLUMN IF NOT EXISTS cashapp_tag text,
  ADD COLUMN IF NOT EXISTS paypal_username text;

-- Payment status: unpaid -> self_reported -> confirmed
ALTER TABLE league_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS self_reported_at timestamptz;

-- Backfill from existing boolean
UPDATE league_payments SET status = 'confirmed' WHERE paid = true AND status = 'unpaid';

-- RLS: team owners can self-report their own payment
CREATE POLICY "Team owners can self-report payment"
  ON league_payments FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM teams WHERE teams.id = league_payments.team_id AND teams.user_id = auth.uid())
  )
  WITH CHECK (
    status = 'self_reported'
    AND EXISTS (SELECT 1 FROM teams WHERE teams.id = league_payments.team_id AND teams.user_id = auth.uid())
  );

CREATE POLICY "Team owners can insert self-report"
  ON league_payments FOR INSERT TO authenticated
  WITH CHECK (
    status = 'self_reported'
    AND EXISTS (SELECT 1 FROM teams WHERE teams.id = league_payments.team_id AND teams.user_id = auth.uid())
  );

-- All league members can read payment status
CREATE POLICY "League members can read payments"
  ON league_payments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM teams WHERE teams.league_id = league_payments.league_id AND teams.user_id = auth.uid())
  );
