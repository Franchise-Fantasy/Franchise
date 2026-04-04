-- RevenueCat integration columns for subscription tables
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS rc_customer_id text,
  ADD COLUMN IF NOT EXISTS rc_product_id text,
  ADD COLUMN IF NOT EXISTS period_type text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS auto_renew boolean DEFAULT true;

ALTER TABLE league_subscriptions
  ADD COLUMN IF NOT EXISTS rc_customer_id text,
  ADD COLUMN IF NOT EXISTS rc_product_id text,
  ADD COLUMN IF NOT EXISTS period_type text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS auto_renew boolean DEFAULT true;

-- Indexes for webhook lookups by RevenueCat customer ID
CREATE INDEX IF NOT EXISTS idx_user_sub_rc_customer
  ON user_subscriptions(rc_customer_id);
CREATE INDEX IF NOT EXISTS idx_league_sub_rc_customer
  ON league_subscriptions(rc_customer_id);

-- Subscription event log for audit trail and analytics
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  league_id uuid REFERENCES leagues(id),
  event_type text NOT NULL,
  tier text NOT NULL,
  rc_event_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- RLS: users can read their own events
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription events"
  ON subscription_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
