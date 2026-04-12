-- Add unique constraint on rc_event_id to prevent duplicate webhook processing.
-- RevenueCat can retry webhooks; without this, the same event is processed twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_events_rc_event_id
  ON subscription_events (rc_event_id)
  WHERE rc_event_id IS NOT NULL AND rc_event_id <> '';
